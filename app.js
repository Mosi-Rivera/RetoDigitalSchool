const mysql = require('mysql2');
const body_parser = require('body-parser');
const express = require('express');
// const cors = require('cors');
const path = require('path');
const Mutex = require('async-mutex').Mutex;
require('dotenv').config();
const mutex = new Mutex();
const parser = body_parser.json()
const app = express();
// app.use(cors());
app.use(express.static(path.join(__dirname, ".", "build")));
app.use(express.static("public"));
app.use(parser);
const port = 3000;
const capacity = 30;
const mysql_connection = mysql.createConnection({
    host: 'localhost',
    port: 3306,
    database: 'parqueadero',
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD
});

//GUARDS
const licensePlateGuard = (req, res, next) => {
    console.log(req.body, req.params);
    const plate = req.body.plate || req.params.plate;
    if (!plate)
        return res.status(500).send('No plate number given.');
    res.locals.plate = plate;
    next();
}

const vehicleExistsGuard = async (req, res, next) => {
    const plate = res.locals.plate;
    try
    {
        const vehicle = (await getVehicle(plate))[0];
        console.log(vehicle, plate);
        if (!vehicle)
            throw new Error('invalid plate number');
        res.locals.vehicle = vehicle;
        next();
    }
    catch(err)
    {
        console.log(err);
        res.status(500).send(err);
    }
}

//QUERY METHODS
const query = (sql) => new Promise((resolve, reject) => {
    mysql_connection.query(sql, (err, result) => {
        if (err)
            return reject(err);
        return resolve(result);
    });
});

const createDatabase = () => query("CREATE DATABASE IF NOT EXISTS parqueadero");

const createVehiclesTable = () => query("CREATE TABLE IF NOT EXISTS vehicles (plate VARCHAR(255) NOT NULL, date BIGINT NOT NULL, UNIQUE (plate))");

const addVehicle = (plate) => {
    const time = Date.now();
    return (query(`INSERT INTO vehicles (plate, date) VALUES (${mysql_connection.escape(plate)}, ${mysql_connection.escape(time)})`));
};

const getAllVehicles = () => {
    return (query("SELECT * FROM vehicles"));
}

const getVehicle = (plate) => {
    return (query(`SELECT * FROM vehicles WHERE plate = ${mysql_connection.escape(plate)}`));
}

const getVehicleCount = () => {
    return (query('SELECT COUNT(*) AS count FROM vehicles'));
}

const removeVehicle = (plate) => {
    return (query(`DELETE FROM vehicles WHERE plate = ${mysql_connection.escape(plate)}`));
}

//CALCULATIONS
const calculate_cost = (entry_time, now) => {
    now = now || Date.now();
    const delta = now - entry_time;
    const minutes = delta / (1000 * 60);
    return {cost: (100 * Math.ceil(minutes)), time: minutes};
};

//ROUTES
app.post('/api/add_vehicle', licensePlateGuard, async (req, res) => {
    const plate = res.locals.plate;
    const release = await mutex.acquire();
    try
    {
        const count = (await getVehicleCount())[0].count;
        if (count >= capacity)
            throw new Error('Parking full, could not add vehicle.');
        await addVehicle(plate);
        res.status(200).json({success: true});
    }
    catch(err)
    {
        console.log(err);
        res.status(500).send(err.message);
    }
    finally
    {
        release();
    }
});

app.post('/api/remove_vehicle', licensePlateGuard, vehicleExistsGuard, async (req, res) => {
    const plate = res.locals.plate;
    const release = await mutex.acquire();
    try
    {
        await removeVehicle(plate);
        res.status(200).json(calculate_cost(res.locals.vehicle.date));
    }
    catch(err)
    {
        console.log(err);
        res.status(500).send(err);
    }
    finally
    {
        release();
    }
});

app.get('/api/get_vehicle/:plate', licensePlateGuard, vehicleExistsGuard, (req, res) => {
    const vehicle = res.locals.vehicle;
    const date = new Date(vehicle.date);
    let hours = date.getHours();
    let minutes = date.getMinutes();
    hours = (hours < 10 ? '0' : '') + hours;
    minutes = (minutes < 10 ? '0' : '') + minutes;
    const info = {
        plate: vehicle.plate,
        time: hours + ':' + minutes
    };
    console.log(info);
    res.status(200).json(info);
});

app.get('/api/', async (req, res) => {
    try
    {
        const vehicles = await getAllVehicles();
        vehicles.forEach(elem => elem.date = new Date(elem.date).toDateString());
        console.log('got all vehocles', vehicles);
        res.status(200).json(vehicles);
    }
    catch(err)
    {
        console.log(err);
        res.status(500).send(err);
    }
});

app.use((req, res, next) => {
    res.sendFile(path.join(__dirname, ".", "build", "index.html"));
});

app.get('*', (req, res) => {
    res.status(404).send("Route not found.");
});

mysql_connection.connect((err) => {
    if (err)
        throw err;
    console.log('connected to db!');
    
    Promise.all([createDatabase(), createVehiclesTable()])
    .then(() => {
        app.listen(port, () => {
            console.log('Listening on port: ' + port);
        });
    });
});