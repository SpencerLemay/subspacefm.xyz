import gulp from 'gulp';
import concat from 'gulp-concat';
import cleanCss from 'gulp-clean-css';

// Concat and minify CSS files
gulp.task('build-css', () => {
    return gulp.src('../style/*.css')
    .pipe(concat('style_build.css'))
    .pipe(cleanCss())
    .pipe(gulp.dest('../style'));
});

// Concat and minify application specific JS files
gulp.task('build-js', function () {
    return gulp.src(['../scripts/bundle.js'])
        .pipe(concat('bundle_build.js'))
        .pipe(uglify())
        .pipe(gulp.dest('../scripts/'));
});

gulp.task("session-start", (cb) => {
    return gulp.series('build-css')(cb);
    return gulp.series('build-js')(cb);
});

gulp.task('default', gulp.series('session-start'));
