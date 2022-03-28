const{src:src,dest:dest,watch:watch,series:series}=require("gulp"),prefix=require("gulp-autoprefixer"),terser=require("gulp-terser"),imagemin=require("gulp-imagemin"),imagewebp=require("gulp-webp");function optimizeimg(){return src("../images/*.{jpg,png}").pipe(imagemin([imagemin.mozjpeg({quality:80,progressive:!0}),imagemin.optipng({optimizationLevel:2})])).pipe(dest("../dist/images"))}function webpImage(){return src("../dist/images/*.{jpg,png}").pipe(imagewebp()).pipe(dest("../dist/images"))}function jsmin(){return src("../scripts/*.js").pipe(terser()).pipe(dest("../dist/script"))}function watchTask(){watch("../scripts/bundle.js",jsmin),watch("../images/*",optimizeimg),watch("../dist/images/*.{jpg,png}",webpImage)}exports.default=series(jsmin,optimizeimg,webpImage,watchTask);