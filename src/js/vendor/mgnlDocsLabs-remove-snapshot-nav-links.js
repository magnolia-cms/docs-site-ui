//Script info: https://tinyurl.com/mgnlDocsLabs-Rsnl

function removeSnapshotsNavLinks () {
  //  remove the SNAPSHOT repo links in the breadcrumbs nav menu
  if (document.getElementsByClassName('version-menu')[0] != null) {
    const breadcrumbsNavElements = document.getElementsByClassName('version-menu')[0].children
    for (let i = 0; i < breadcrumbsNavElements.length; i++) {
      const pos = breadcrumbsNavElements[i].innerText.indexOf('-SNAPSHOT')
      if (pos !== -1) {
        // remove the link
        breadcrumbsNavElements[i].style = 'display: none;'
        // restyle the nav box for the single remaining link
        if (breadcrumbsNavElements.length === 2) {
          const menuToggle = document.getElementsByClassName('version-menu-toggle')
          menuToggle[0].style = 'padding-right: .5rem; background: none; pointer-events: none;'
          menuToggle[0].setAttribute('title', 'Page version')
        }
      }
    }
  }
  //  remove the SNAPSHOT repo links in the bottom repo nav menu
  if (document.querySelectorAll('.version > a').length > 0) {
    // get all LI parents of the A repo links
    const repoNavElements = document.querySelectorAll('ul.versions > li.version')
    for (let i2 = 0; i2 < repoNavElements.length; i2++) {
      // if the A link (LI's child) contains the string, hide the parent LI element
      const pos2 = repoNavElements[i2].firstElementChild.innerText.indexOf('-SNAPSHOT')
      if (pos2 !== -1) {
        repoNavElements[i2].style = 'display: none;'
      }
    }
  }
}

removeSnapshotsNavLinks()
