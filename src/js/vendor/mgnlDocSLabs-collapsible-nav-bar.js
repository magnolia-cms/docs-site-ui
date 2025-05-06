// Script info: https://tinyurl.com/mgnlDocsLabs-Cnb

var switchStatus = false
var nav = document.getElementsByClassName('nav-container')[0]
var content = document.getElementsByClassName('content')[0]
var navButton = '<div id=\'nav-toggle-button\'></div>'
var style = document.createElement('style')
style.innerHTML = '@media screen and (min-width: 1024px) { ' +
                  '  #nav-toggle-button { ' +
                  '  cursor: pointer; ' +
                  '  height: 6rem; ' +
                  '  width: 3rem; ' +
                  '  top: 45%; ' +
                  '  position: fixed; ' +
                  '  margin-left: -2.1rem; ' +
                  '  padding: 5px; ' +
                  '  z-index: 0; ' +
                  '  display: block; ' +
                  '  border-radius: 10px 15px 15px 10px; ' +
                  ' -webkit-transform: rotate(0deg); ' +
                  '  transition: all .275s ease-in-out; ' +
                  '  transition-duration: 0.275s; ' +
                  '  transition-timing-function: ease-in-out; ' +
                  '  transition-delay: 0s; ' +
                  '  transition-property: all; ' +
                  '  color: #f5f5f5; ' +
                  '  background-color:#999; ' +
                  '  text-align: -webkit-center; ' +
                  '  opacity: 0.1; ' +
                  '  } ' +
                  '  } '
document.head.appendChild(style)
content.insertAdjacentHTML('afterbegin', navButton)
var toggler = document.getElementById('nav-toggle-button')

function areaFn () {
  if (switchStatus === false) {
    nav.style.display = 'none'
  } else {
    nav.style.display = 'block'
  }
  switchStatus = !switchStatus
}

function mouseenter () {
  if (switchStatus === false) {
    toggler.style.opacity = '0.5'
  } else {
    toggler.style.opacity = '1'
  }
}

function mouseleave () {
  if (switchStatus === false) {
    toggler.style.opacity = '0.1'
  } else {
    toggler.style.opacity = '0.5'
  }
}

toggler.addEventListener('click', areaFn)
toggler.addEventListener('mouseenter', mouseenter, false)
toggler.addEventListener('mouseleave', mouseleave, false)
