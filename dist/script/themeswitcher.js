function setTheme(e){localStorage.setItem("theme",e),document.documentElement.className=e}function toggleTheme(){"theme-dark"===localStorage.getItem("theme")?setTheme("theme-light"):setTheme("theme-dark")}!function(){for(var e=["theme-light","theme-dark","theme-pink","theme-green","theme-yellow"],t=localStorage.getItem("theme"),h=0;h<e.length;h++)t===e[h]&&setTheme(t);h==e.length-1&&setTheme("theme-light"),$("#light").click((function(){t=localStorage.getItem("theme");for(var h=1;h<e.length;h++)if(t===e[h])return setTheme(e[--h]),void(player.started=2);setTheme(e[e.length-1])})),$("#dark").click((function(){t=localStorage.getItem("theme");for(var h=0;h<e.length-1;h++)if(t===e[h])return setTheme(e[++h]),void(player.started=2);setTheme(e[0])}))}();