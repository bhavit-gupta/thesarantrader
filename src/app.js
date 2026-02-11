const express = require('express');
const path = require('path');

const app = express();

// Set EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => res.render("layouts/index"));
app.get('/courses', (req, res) => res.render("layouts/courses"));
app.get('/login', (req, res) => res.render("layouts/login"));
app.get('/signup', (req, res) => res.render("layouts/signup"));
app.get('/forgetPassword', (req, res) => res.render("layouts/forgetPassword"));
app.get('/verifyOTP', (req, res) => res.render("layouts/verifyOTP"));
app.get('/enroll', (req, res) => res.render("layouts/enroll"));

// Auth API routes
const authRoutes = require("./routes/auth.route");
app.use("/auth", authRoutes);

module.exports = app;
