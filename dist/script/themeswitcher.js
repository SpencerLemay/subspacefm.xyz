function setTheme(e){localStorage.setItem("theme",e),document.documentElement.className=e}function toggleTheme(){"theme-dark"===localStorage.getItem("theme")?setTheme("theme-light"):setTheme("theme-dark")}!function(){for(var e=["theme-light","theme-dark","theme-pink","theme-green","theme-yellow"],t=localStorage.getItem("theme"),m=0;m<e.length;m++)t===e[m]&&setTheme(t);m==e.length&&setTheme("theme-light"),$("#dark").click((function(){t=localStorage.getItem("theme");for(var m=0;m<e.length;m++)if(t===e[m])return void setTheme(e[++m]);setTheme("theme-light")}))}();