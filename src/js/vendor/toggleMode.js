'use strict'

var toggleSwitch = document.querySelector('input[type="checkbox"]');
var nav = document.getElementById('nav');
var toggleIcon = document.getElementById('toggle-icon');
var textBox = document.getElementById('text-box');

// images
// function imageMode(color) {
//     image1.src = `img/undraw_proud_coder_${color}.svg`;
//     image2.src = `img/undraw_feeling_proud_${color}.svg`;
//     image3.src = `img/undraw_conceptual_idea_${color}.svg`;
// }

//
function toggleDarkLightMode(isDark) {
    nav.style.backgroundColor = isDark ? 'rgb(0 0 0 / 50%)' : 'rgb(255 255 255 / 50%)';
    textBox.style.backgroundColor = isDark ? 'rgb(255 255 255 / 50%)' : 'rgb(0 0 0 / 50%)';
    isDark ? toggleIcon.children[0].classList.replace('fa-sun', 'fa-moon') :
        toggleIcon.children[0].classList.replace('fa-moon', 'fa-sun')
    isDark ? imageMode('dark') : imageMode('light');
}

// switch theme dynamically
function switchTheme(event) {
    if (event.target.checked) {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme','dark');
        toggleDarkLightMode(true);
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('theme','light');
        toggleDarkLightMode(false);
    }
}

// event listener
toggleSwitch.addEventListener('change', switchTheme);

// check local storage for theme preference
var currentTheme = localStorage.getItem('theme');

if(currentTheme) {
    document.documentElement.setAttribute('data-theme', currentTheme);

    if(currentTheme === 'dark') {
        toggleSwitch.checked = true;
        toggleDarkLightMode(true);
    }
}
