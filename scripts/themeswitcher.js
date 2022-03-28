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
   if (localStorage.getItem('theme') === 'theme-dark') {
       setTheme('theme-dark');
       window.gradient.addColorStop(1, '#aaa');
       window.gradient.addColorStop(0.5, '#777');
       window.gradient.addColorStop(0, '#555');
   } else {
       setTheme('theme-light');
      window.gradient.addColorStop(1, '#333');
      window.gradient.addColorStop(0.5, '#999');
      window.gradient.addColorStop(0, '#fff');
   }

   $("#light").click(function(){
       setTheme('theme-light');
       window.gradient.addColorStop(1, '#333');
       window.gradient.addColorStop(0.5, '#999');
       window.gradient.addColorStop(0, '#fff');
      }); 
      $("#dark").click(function(){
       setTheme('theme-dark');       
       window.gradient.addColorStop(1, '#aaa');
       window.gradient.addColorStop(0.5, '#777');
       window.gradient.addColorStop(0, '#555');
      }); 
})();