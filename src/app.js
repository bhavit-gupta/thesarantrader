const express = require('express');
const app = express();
const path = require('path');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'))
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.render("./layouts/index")
})

app.get('/courses', (req, res) => {
    res.render("./layouts/courses")
})

app.get('/login', (req, res) => {
    res.render("./layouts/login")
})

app.get('/signup', (req, res) => {
    res.render("./layouts/signup")
})

app.get('/forgetPassword', (req, res) => {
    res.render("./layouts/forgetPassword")
})

app.get('/verifyOTP', (req, res) => {
    res.render("./layouts/verifyOTP")
})

app.get('/enroll', (req, res) => {
    res.render("./layouts/enroll")
})

module.exports = app;

