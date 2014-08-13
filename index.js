var path = require('path');
var fs = require('fs');
var urlparse = require('url').parse;
var through = require('through2');
var pipe = require('multipipe');
var gulp = require('gulp');
var less = require('gulp-less');
var gulpif = require('gulp-if');
var coffee = require('gulp-coffee');
var mime = require('mime');
var extend = require('extend');

var cssParser = require('./parser/css');
var css2jsParser = require('./parser/css2js');
var jsParser = require('./parser/js');
var tplParser = require('./parser/tpl');
var jsonParser = require('./parser/json');
var handlebarsParser = require('./parser/handlebars');
var standalonify = require('./parser/standalonify');
var Parser = require('./parser');
var util = require('./util');


module.exports = function(root, opts) {
  return function() {
    var args = Array.prototype.concat.apply([root, opts || {}], arguments);
    parse.apply(this, args);
  };
};

function parse(root, opts, req, res, next) {
  next = next || function() {
    res.writeHead(404);
    res.end('');
  };

  var parser = new Parser(extend({
    root: root,
    req: urlparse(req.url.toLowerCase()),
    headers: req.headers,
    pkg: util.getPkg(root)
  }, opts));

  // is dep package, but not found
  if (!parser.pkg) {
    return next();
  }

  // don't handle if file is not found
  if (!parser.file) {
    return next();
  }

  // don't handle dir
  if (parser.isDir) {
    return next();
  }

  // 304
  var isModified = parser.isModified();
  res.setHeader('Last-Modified', parser.modifiedTime);
  if (!isModified) {
    res.writeHead(304);
    return res.end('');
  }

  if (opts.log) {
    console.log('>> ServeSPM %s < ./%s',
      parser.req.pathname, path.relative(process.cwd(), parser.file));
  }

  // nowrap
  if (parser.noWrap) {
    var data = fs.readFileSync(parser.file, 'utf-8');
    if (parser.handlebarId) {
      data = util.template(data, {id:parser.handlebarId});
    }
    return end(data, res, path.extname(parser.file));
  }

  // transport file

  var file = parser.file;
  var args = {pkg:parser.pkg};

  var useCss2jsParser = util.isCSSFile(file) &&
    /\.js$/.test(parser.req.pathname);
  var useStandalone = function(file) {
    return parser.isStandalone(file.path);
  };

  pipe(
    gulp.src(file),

    gulpif(/\.less$/, less({ paths: [path.dirname(file)] })),
    gulpif(/\.css$/, cssParser(args)),
    gulpif(useCss2jsParser, css2jsParser(args)),
    gulpif(/\.coffee$/, coffee({bare: true})),
    gulpif(/\.js$/, jsParser(args)),
    gulpif(/\.tpl$/, tplParser(args)),
    gulpif(/\.json$/, jsonParser(args)),
    gulpif(/\.handlebars$/, handlebarsParser(args)),
    gulpif(useStandalone, standalonify(req.url)),

    through.obj(function(file) {
      var data = String(file.contents);
      var ext = path.extname(file.path);
      end(data, res, ext);
    })
  );
}

function end(data, res, extname) {
  if (['.tpl', '.json', '.handlebars'].indexOf(extname) > -1) {
    extname = '.js';
  }
  res.setHeader('Content-Type', mime.lookup(extname));
  res.writeHead(200);
  res.end(data);
}
