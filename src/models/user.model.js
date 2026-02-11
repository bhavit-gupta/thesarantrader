const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 50
  },

  username: {
    type: String,
    unique: true,
    required: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 20,
    match: /^[a-z0-9_]+$/
  },

  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },

  phone: {
    type: String,
    required: true,
    trim: true,
    match: /^[0-9]{10}$/
  },

  state: {
    type: String,
    required: true,
    trim: true
  },

  city: {
    type: String,
    required: true,
    trim: true
  },

  password: {
    type: String,
    required: true,
    minlength: 6,
    select: false
  }

}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

module.exports = mongoose.model('User', userSchema);
