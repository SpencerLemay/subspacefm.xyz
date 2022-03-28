// see video explanation: https://youtu.be/ubHwScDfRQA

const { src, dest, watch, series} = require('gulp');
const prefix = require('gulp-autoprefixer');
const terser = require('gulp-terser');
const imagemin = require('gulp-imagemin');
const imagewebp = require('gulp-webp');



//optimize and move images
function optimizeimg() {
  return src('../images/*.{jpg,png}') // change to your source directory
    .pipe(imagemin([
      imagemin.mozjpeg({ quality: 80, progressive: true }),
      imagemin.optipng({ optimizationLevel: 2 }),
    ]))
    .pipe(dest('../dist/images')) // change to your final/public directory
};

//optimize and move images
function webpImage() {
  return src('../dist/images/*.{jpg,png}') // change to your source directory
    .pipe(imagewebp())
    .pipe(dest('../dist/images')) // change to your final/public directory
};


// minify js
function jsmin(){
  return src('../scripts/*.js') // change to your source directory
    .pipe(terser())
    .pipe(dest('../dist/script')); // change to your final/public directory
}

//watchtask
function watchTask(){
  watch('../scripts/bundle.js', jsmin); // change to your source directory
  watch('../images/*', optimizeimg); // change to your source directory
  watch('../dist/images/*.{jpg,png}', webpImage); // change to your source directory
}


// Default Gulp task 
exports.default = series(
  jsmin,
  optimizeimg,
  webpImage,
  watchTask
);