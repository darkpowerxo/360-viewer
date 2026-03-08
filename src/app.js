const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const config = require('./config');

const browseRouter = require('./routes/browse');
const mediaRouter = require('./routes/media');
const thumbnailRouter = require('./routes/thumbnail');
const viewRouter = require('./routes/view');
const apiRouter = require('./routes/api');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => res.redirect('/browse/'));
app.use('/browse', browseRouter);
app.use('/view', viewRouter);
app.use('/media', mediaRouter);
app.use('/thumb', thumbnailRouter);
app.use('/api', apiRouter);

app.use((req, res) => {
  res.status(404).render('error', { title: '404', message: 'Page not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { title: '500', message: 'Internal server error' });
});

module.exports = app;
