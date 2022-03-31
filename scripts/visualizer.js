/* * 
 * audio visualizer with html5 audio element
 *
 * v0.1.0
 * 
 * licenced under the MIT license
 * 
 * see my related repos:
 * - HTML5_Audio_Visualizer https://github.com/wayou/HTML5_Audio_Visualizer
 * - 3D_Audio_Spectrum_VIsualizer https://github.com/wayou/3D_Audio_Spectrum_VIsualizer
 * - selected https://github.com/wayou/selected
 * - MeowmeowPlayer https://github.com/wayou/MeowmeowPlayer
 * 
 * reference: http://www.patrick-wied.at/blog/how-to-create-audio-visualizations-with-javascript-html
 */

window.AudioContext = window.AudioContext || window.webkitAudioContext || window.mozAudioContext;


var visualizerStart = function() {
   //breaks chrome if not here
    
   if (player.started != undefined)
       return;
   player.started = 1;
   var ctx = new AudioContext();
    var analyser = ctx.createAnalyser();
    var audioSrc = ctx.createMediaElementSource(player.audioElement);

    
    // we have to connect the MediaElementSource with the analyser 
    audioSrc.connect(analyser);
    analyser.connect(ctx.destination);
    // we could configure the analyser: e.g. analyser.fftSize (for further infos read the spec)
    // analyser.fftSize = 64;
    // frequencyBinCount tells you how many values you'll receive from the analyser
    var frequencyData = new Uint8Array(analyser.frequencyBinCount);
     var top,mid,btm,cap_color;
     switch(localStorage.getItem('theme')){
     case 'theme-dark':
             btm = [1,'#717e80']
             mid= [0.5, '#3d4445'];
             top = [0,'#131b1c'];
             cap_color = '#131b1c';
             break;
    default:        
    case 'theme-light': 
             btm = [1,'#000']
             mid= [0.5, '#777'];
             top = [0,'#bbb'];
             cap_color = '#000';
             break;
     case 'theme-pink':               
             btm = [1,'#af9bbb']
             mid= [0.5, '#c5bdc9'];
             top = [0,'#fff'];
             cap_color = '#fff';
             break;
     case 'theme-green':
             btm = [1,'#bfcabc']
             mid= [0.5, '#96b68d'];
             top = [0,'#fff'];
             cap_color = '#538740';
     break; 
     case 'theme-yellow':
             btm = [1,'#723b04']
             mid= [0.5, '#c89c4d'];
             top = [0,'#c89c4d'];
             cap_color = '#723b04';
     break; 

     }
    // we're ready to receive some data!
    var canvas = document.getElementById('canvas'),
        cwidth = canvas.width,
        cheight = canvas.height - 2,
        meterWidth = 10, //width of the meters in the spectrum
        gap = 2, //gap between meters
        capHeight = 2,
        capStyle = cap_color,
        meterNum = 800/ (10 + 2), //count of the meters
        capYPositionArray = []; ////store the vertical position of hte caps for the preivous frame
    var gradient;
    ctx = canvas.getContext('2d'),
    gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(btm[0],btm[1]);
    gradient.addColorStop(mid[0],mid[1]);
    gradient.addColorStop(top[0], top[1]);


    // loop
    function renderFrame() {
        var array = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);
        var step = Math.round(array.length / meterNum); //sample limited data from the total array
        ctx.clearRect(0, 0, cwidth, cheight);
        for (var i = 0; i < meterNum; i++) {
            var value = array[i * step];
            if (capYPositionArray.length < Math.round(meterNum)) {
                capYPositionArray.push(value);
            };
            ctx.fillStyle = capStyle;
            //draw the cap, with transition effect
            if (value < capYPositionArray[i]) {
                ctx.fillRect(i * 12, cheight - (--capYPositionArray[i]), meterWidth, capHeight);
            } else {
                ctx.fillRect(i * 12, cheight - value, meterWidth, capHeight);
                capYPositionArray[i] = value;
            };
            ctx.fillStyle = gradient; //set the filllStyle to gradient for a better look
            ctx.fillRect(i * 12 /*meterWidth+gap*/ , cheight - value + capHeight, meterWidth, cheight); //the meter
        }
        requestAnimationFrame(renderFrame);
    }
    renderFrame();
};
$(function(){

$("#play").click(function(){
   visualizerStart();
}); 
});