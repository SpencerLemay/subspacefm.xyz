

// function to set a given theme/color-scheme
function setTheme(themeName) {
    localStorage.setItem('theme', themeName);
    document.documentElement.className = themeName;
}// function to toggle between light and dark theme
function toggleTheme() {
   if (localStorage.getItem('theme') === 'theme-dark'){
       setTheme('theme-light');
   } else {
       setTheme('theme-dark');
   }
}// Immediately invoked function to set the theme on initial load
(function () {

   var themes = [
   "theme-light",
   "theme-dark",
   "theme-pink",
   "theme-green",
   "theme-yellow"
   ];

   var theme = localStorage.getItem('theme');
   for (var i = 0;i < themes.length ;i++)  {
         if (theme === themes[i]) {
              setTheme(theme);
              }
         } 
   if (i == themes.length - 1) {
       setTheme('theme-light');
   }

    $("#light").click(function(){

       theme = localStorage.getItem('theme');
       for (var i = 1;i < themes.length;i++)  {
             if (theme === themes[i]) {
                  setTheme(themes[--i]);
                  if (player.state === "loading" || player.state === "playing"){
                     visualizerStart();
                  }
                  return;
                  }
             }       
       setTheme(themes[themes.length - 1]); 
      }); 
    $("#dark").click(function(){

       theme = localStorage.getItem('theme');
       for (var i = 0;i < themes.length -1;i++)  {
             if (theme === themes[i]) {
                  setTheme(themes[++i]);
                   if (player.state === "loading" || player.state === "playing"){
                     visualizerStart();
                  }
                  return;
                  }
             }       
       setTheme(themes[0]); 
      }); 
})();