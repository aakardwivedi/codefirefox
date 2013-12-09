var express = require('express'),
  async = require("async"),
  routes = require('./routes'),
  stylus = require('stylus'),
  db = require('./db'),
  RedisStore = require('connect-redis')(express);


// Configuration
const PORT = 22935;
const HOUR = 3600000;
const DAY = 24 * HOUR;

var app = express();
var serverRunningSince = new Date();

var runSite = function(err, config) {
  if (err) {
    console.log('Error starting server, aborting');
    process.exit();
    return;
  }

  console.log('redis host: ' + config.redisHost);
  console.log('redis port: ' + config.redisPort);

  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.set('view options', { layout: false, pretty: true });
  app.use(express.urlencoded())
     .use(express.bodyParser())
     .use(express.cookieParser())
     .use(express.json()) 
     .use(stylus.middleware({
       src: __dirname + '/public',
       compress: true
     }))
     .use(express.static(__dirname + '/public'))
     .use(express.session({
       secret: config.sessionSecret,
       store: new RedisStore({
         port: config.redisPort,
         host: config.redisHost,
       }),
       // Expire cookies by default 30 days from now
       cookie: { path: '/', httpOnly: true, maxAge: DAY * 30 }
     }))
     .use(function(req, res, next) {
        // session updated
        // Allow the session variables to be accessible from res.locals
        // session contains:
        //   email
        //   isAdmin
        res.locals.session = req.session;
        res.locals.session.serverRunningSince = serverRunningSince;

        // Allowed to modify session
        if (req.url == '/persona/verify' || req.url == '/persona/logout') {
          console.log('Request for: ' + req.url);
        } else {
          req.session = null;
        }
         
        next();
     });

  var serverURL = 'http://' + config.host +
    (config.port == 80 ? '' : (':' + config.port));
  console.log('server callback URL for Persona: ' + serverURL);
  require('express-persona')(app, {
    audience: serverURL,
    verifyResponse: function(error, req, res, email) {
      var out;
      if (error) {
        out = { status: "failure", reason: error };
        res.json(out);
      } else {

        // Session vars that our server should know about
        req.session.isAdmin = false;
        config.admins.forEach(function(e) {
          req.session.isAdmin = req.session.isAdmin || req.session.email == e;
        });
        req.session.isTrusted =  req.session.isAdmin;

        console.log('User logged in: ' + req.session.email);
        db.reportUserLogin(req.session.email);

        // Stuff to let the client know about
        out = { isAdmin: req.session.isAdmin,
                isTrusted: req.session.isTrusted,
                status: "okay",
                email: req.session.email
              };

        var userInfoKey = 'user:' + req.session.email + ':info';
        db.get(userInfoKey, function (err, info) {
          if (err) {
            info = {};
          }

          var now = new Date();
          info.dateLastLogin = now.toISOString();
          info.lastLoginIP = req.connection.remoteAddress;
      	  if (info.lastLoginIP == '127.0.0.1' &&
              config.host == 'codefirefox.com') {
            info.lastLoginIP = req.get('HTTP_X_FORWARDED_FOR');
          }

          if (!info.dateJoined) {
            info.dateJoined = now.toISOString();
          }

          console.log('info key is: ' + userInfoKey);
          db.set(userInfoKey, info);
          res.json(out);
        });
      }
    },
  });

  // Routes
  app.get('/', routes.videos);
  app.get('/:category/:video', routes.video);
  app.get('/cheatsheet', routes.cheatsheet);
  app.get('/initVideoData', routes.initVideoData);
  app.get('/videos', routes.videos);
  app.get('/about', routes.about);
  app.get('/stats', routes.stats);
  app.get('/admin', routes.admin);

  // API
  app.post('/:category/:video', routes.watchedVideo);
  app.del('/stats', routes.delStats);

  app.use(function(req,res){
    res.render('notFound');
  });

  // Determine the environment like this: NODE_ENV=production node app.js
  app.configure('development', function(){
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
    app.locals.pretty = true;
  });

  app.configure('production', function(){
    app.use(express.errorHandler());
    process.on('uncaughtException', function (exception) {
      console.error(exception);
    });
  });

  app.listen(PORT, function() {
    console.log("Starting server on port %d in %s mode", PORT, app.settings.env);
  });
};

var loadConfig = function() {
  db.initConfigData(runSite);
}


loadConfig();
