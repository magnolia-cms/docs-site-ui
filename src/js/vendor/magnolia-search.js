/* eslint-disable */

/**
 * Magnolia Docs Search Client
 * 
 * A lightweight client-side search library with:
 * - Fuzzy matching
 * - Version filtering
 * - Relevance scoring
 * - No external dependencies
 * 
 * ES5 compatible for UglifyJS
 */

(function(global) {
  'use strict';

  function MagnoliaSearch(options) {
    options = options || {};
    this.index = [];
    this.loaded = false;
    this.indexUrl = options.indexUrl || '/search-data/search-index.min.json';
    this.onReady = options.onReady || function() {};
    
    // Search configuration
    this.config = {
      minQueryLength: 2,
      maxResults: 20,
      fuzzyThreshold: 0.4,
      fieldWeights: {
        title: 10,
        heading: 8,
        content: 3,
        breadcrumb: 2
      }
    };
    
    this.invertedIndex = null;
  }

  /**
   * Load the search index
   */
  MagnoliaSearch.prototype.load = function() {
    var self = this;
    
    if (this.loaded) {
      return Promise.resolve();
    }
    
    return fetch(this.indexUrl)
      .then(function(response) {
        if (!response.ok) throw new Error('Failed to load search index');
        return response.json();
      })
      .then(function(data) {
        self.index = data;
        self.loaded = true;
        self._buildInvertedIndex();
        self.onReady();
      })
      .catch(function(err) {
        console.error('MagnoliaSearch: Failed to load index', err);
        throw err;
      });
  };

  /**
   * Build inverted index for faster search
   */
  MagnoliaSearch.prototype._buildInvertedIndex = function() {
    // Use Object.create(null) to avoid prototype property conflicts
    this.invertedIndex = Object.create(null);
    
    for (var docIndex = 0; docIndex < this.index.length; docIndex++) {
      var doc = this.index[docIndex];
      var text = doc._searchText || '';
      var words = this._tokenize(text);
      
      for (var i = 0; i < words.length; i++) {
        var word = words[i];
        // Skip words that could conflict with object properties
        if (word === 'constructor' || word === '__proto__' || word === 'prototype') {
          continue;
        }
        if (!(word in this.invertedIndex)) {
          this.invertedIndex[word] = [];
        }
        var arr = this.invertedIndex[word];
        if (arr.indexOf(docIndex) === -1) {
          arr.push(docIndex);
        }
      }
    }
    
    console.log('MagnoliaSearch: Built inverted index with', Object.keys(this.invertedIndex).length, 'terms from', this.index.length, 'documents');
  };

  /**
   * Main search function
   */
  MagnoliaSearch.prototype.search = function(query, options) {
    options = options || {};
    
    if (!this.loaded || !query || query.length < this.config.minQueryLength) {
      return [];
    }
    
    var maxResults = options.maxResults || this.config.maxResults;
    var versionFilter = options.version || null;
    
    // Tokenize query
    var queryTokens = this._tokenize(query.toLowerCase());
    if (queryTokens.length === 0) return [];
    
    // Find candidate documents using inverted index
    var candidates = this._findCandidates(queryTokens);
    
    // Score and filter candidates
    var self = this;
    var results = [];
    
    for (var i = 0; i < candidates.length; i++) {
      var docIndex = candidates[i];
      var doc = this.index[docIndex];
      
      // Apply version filter
      if (versionFilter && doc.version !== versionFilter) {
        continue;
      }
      
      // Calculate score
      var score = this._scoreDocument(doc, queryTokens, query);
      if (score > 0) {
        var result = {};
        for (var key in doc) {
          if (doc.hasOwnProperty(key)) {
            result[key] = doc[key];
          }
        }
        result._score = score;
        results.push(result);
      }
    }
    
    // Sort by score descending
    results.sort(function(a, b) {
      return b._score - a._score;
    });
    
    return results.slice(0, maxResults);
  };

  /**
   * Find candidate documents using inverted index
   */
  MagnoliaSearch.prototype._findCandidates = function(queryTokens) {
    var candidateSet = {};
    var self = this;
    
    for (var i = 0; i < queryTokens.length; i++) {
      var token = queryTokens[i];
      
      // Exact match
      if (token in this.invertedIndex) {
        var docs = this.invertedIndex[token];
        for (var j = 0; j < docs.length; j++) {
          candidateSet[docs[j]] = true;
        }
      }
      
      // Prefix match for partial words
      if (token.length >= 3) {
        var keys = Object.keys(this.invertedIndex);
        for (var k = 0; k < keys.length; k++) {
          var indexWord = keys[k];
          if (indexWord.indexOf(token) === 0 || token.indexOf(indexWord) === 0) {
            var prefixDocs = this.invertedIndex[indexWord];
            for (var m = 0; m < prefixDocs.length; m++) {
              candidateSet[prefixDocs[m]] = true;
            }
          }
        }
      }
    }
    
    return Object.keys(candidateSet).map(function(k) {
      return parseInt(k, 10);
    });
  };

  /**
   * Score a document against query
   */
  MagnoliaSearch.prototype._scoreDocument = function(doc, queryTokens, originalQuery) {
    var score = 0;
    var weights = this.config.fieldWeights;
    
    var lowerQuery = originalQuery.toLowerCase();
    var title = (doc.title || '').toLowerCase();
    var heading = (doc.heading || '').toLowerCase();
    var content = (doc.content || '').toLowerCase();
    var searchText = (doc._searchText || '').toLowerCase();
    
    // Exact phrase match bonus
    if (title.indexOf(lowerQuery) !== -1) {
      score += weights.title * 3;
    }
    if (heading.indexOf(lowerQuery) !== -1) {
      score += weights.heading * 2;
    }
    if (content.indexOf(lowerQuery) !== -1) {
      score += weights.content * 1.5;
    }
    
    // Token matches
    for (var i = 0; i < queryTokens.length; i++) {
      var token = queryTokens[i];
      
      if (title.indexOf(token) !== -1) {
        score += weights.title;
      }
      if (heading.indexOf(token) !== -1) {
        score += weights.heading;
      }
      if (content.indexOf(token) !== -1) {
        score += weights.content;
      }
      if (searchText.indexOf(token) !== -1) {
        score += 0.5;
      }
    }
    
    // Boost for h1 headings
    if (doc.headingLevel === 1) {
      score *= 1.2;
    }
    
    return score;
  };

  /**
   * Tokenize text into words
   */
  MagnoliaSearch.prototype._tokenize = function(text) {
    if (!text) return [];
    
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(function(word) {
        return word.length >= 2;
      });
  };

  /**
   * Highlight matches in text
   */
  MagnoliaSearch.prototype.highlight = function(text, query) {
    if (!text || !query) return text || '';
    
    var tokens = this._tokenize(query);
    var result = text;
    
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (token.length < 2) continue;
      
      var regex = new RegExp('(' + this._escapeRegex(token) + ')', 'gi');
      result = result.replace(regex, '<mark>$1</mark>');
    }
    
    return result;
  };

  /**
   * Escape special regex characters
   */
  MagnoliaSearch.prototype._escapeRegex = function(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MagnoliaSearch;
  } else {
    global.MagnoliaSearch = MagnoliaSearch;
  }

})(typeof window !== 'undefined' ? window : this);
/**
 * Magnolia Docs Search UI
 * 
 * A fully decoupled, drop-in search widget with:
 * - Modal search dialog
 * - Dynamic version filtering (auto-detected from index)
 * - Keyboard shortcuts
 * - CSS variable theming
 * - No external dependencies
 * 
 * Usage:
 *   new MagnoliaSearchUI({
 *     container: '#nativeSearch',
 *     indexUrl: '/search-data/search-index.min.json',
 *     placeholder: 'Search docs...',
 *     hotkey: '/'
 *   });
 */

(function(global) {
  'use strict';

  // Default filter configuration - can be overridden via options
  var DEFAULT_FILTERS = [
    { key: '', label: 'All' },
    { key: 'latest', label: '6.4' },
    { key: '6.3', label: '6.3' },
    { key: '6.2', label: '6.2' },
    { key: 'cloud', label: 'Cloud' },
    { key: 'modules', label: 'Modules' }
  ];

  function MagnoliaSearchUI(options) {
    options = options || {};
    
    this.options = {
      container: options.container || '#nativeSearch',
      indexUrl: options.indexUrl || '/search-data/search-index.min.json',
      metadataUrl: options.metadataUrl || '/search-data/metadata.json',
      placeholder: options.placeholder || 'Search documentation...',
      hotkey: options.hotkey || '/',
      maxResults: options.maxResults || 15,
      minChars: options.minChars || 2,
      debounceMs: options.debounceMs || 150,
      filters: options.filters || null, // null = auto-detect from metadata
      showFilters: options.showFilters !== false,
      showFooter: options.showFooter !== false,
      branding: options.branding || 'Powered by Magnolia Search',
      onResultClick: options.onResultClick || null,
      onOpen: options.onOpen || null,
      onClose: options.onClose || null,
      devMode: options.devMode !== undefined ? options.devMode : (typeof window !== 'undefined' && window.location && window.location.search.indexOf('searchDevMode=true') !== -1)
    };
    
    this.search = null;
    this.modal = null;
    this.currentFilter = '';
    this.isOpen = false;
    this.filters = [];
    this.selectedIndex = 0;
    this.indexLoadFailed = false; // Track if index load failed
    
    this._init();
  }

  MagnoliaSearchUI.prototype._init = function() {
    var self = this;
    
    // Initialize search client
    if (typeof MagnoliaSearch === 'undefined') {
      console.error('MagnoliaSearchUI: MagnoliaSearch not found. Include search-client.js first.');
      return;
    }
    
    // Log dev mode status
    if (this.options.devMode) {
      console.log('MagnoliaSearchUI: Dev mode enabled - using dummy results for styling');
    }
    
    this.search = new MagnoliaSearch({
      indexUrl: this.options.indexUrl,
      onReady: function() {
        console.log('MagnoliaSearchUI: Search ready');
      }
    });
    
    // Create UI elements
    this._createTrigger();
    this._createModal();
    this._bindEvents();
    
    // Load search index and metadata
    this._loadData();
  };

  MagnoliaSearchUI.prototype._loadData = function() {
    // Load metadata for dynamic filters (if not manually specified)
    // NOTE: Search index is now loaded lazily when user opens search modal
    if (this.options.filters === null && this.options.showFilters) {
      this._loadMetadata();
    } else if (this.options.filters) {
      this.filters = this.options.filters;
      this._renderFilters();
    } else {
      this.filters = DEFAULT_FILTERS;
      this._renderFilters();
    }
  };

  MagnoliaSearchUI.prototype._loadMetadata = function() {
    var self = this;
    
    fetch(this.options.metadataUrl)
      .then(function(response) {
        if (!response.ok) throw new Error('Metadata not found');
        return response.json();
      })
      .then(function(metadata) {
        self._buildFiltersFromMetadata(metadata);
      })
      .catch(function(err) {
        console.warn('MagnoliaSearchUI: Using default filters (metadata load failed):', err.message);
        self.filters = DEFAULT_FILTERS;
        self._renderFilters();
      });
  };

  MagnoliaSearchUI.prototype._buildFiltersFromMetadata = function(metadata) {
    var filters = [{ key: '', label: 'All' }];
    
    // Map versions to user-friendly labels
    var versionLabels = {
      'latest': '6.4',
      '6.3': '6.3',
      '6.2': '6.2',
      'cloud': 'Cloud',
      'modules': 'Modules'
    };
    
    if (metadata.versions && Array.isArray(metadata.versions)) {
      metadata.versions.forEach(function(version) {
        var label = versionLabels[version] || version;
        filters.push({ key: version, label: label });
      });
    }
    
    this.filters = filters;
    this._renderFilters();
  };

  MagnoliaSearchUI.prototype._createTrigger = function() {
    var container = document.querySelector(this.options.container);
    if (!container) {
      console.warn('MagnoliaSearchUI: Container not found:', this.options.container);
      return;
    }
    
    var self = this;
    
    container.innerHTML = 
      '<button type="button" class="mgnl-search-trigger" aria-label="Search">' +
        '<svg class="mgnl-search-trigger__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="8"/>' +
          '<path d="M21 21l-4.35-4.35"/>' +
        '</svg>' +
        '<span class="mgnl-search-trigger__text">' + this._escapeHtml(this.options.placeholder) + '</span>' +
        '<kbd class="mgnl-search-trigger__kbd">' + this._escapeHtml(this.options.hotkey) + '</kbd>' +
      '</button>';
    
    container.querySelector('.mgnl-search-trigger').addEventListener('click', function() {
      self.open();
    });
  };

  MagnoliaSearchUI.prototype._createModal = function() {
    // Remove existing modal if any
    var existing = document.querySelector('.mgnl-search-modal');
    if (existing) existing.remove();
    
    var modal = document.createElement('div');
    modal.className = 'mgnl-search-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Search');
    
    var footerHtml = '';
    if (this.options.showFooter) {
      footerHtml = 
        '<div class="mgnl-search-modal__footer">' +
          '<div class="mgnl-search-modal__hints">' +
            '<span><kbd>↵</kbd> to select</span>' +
            '<span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>' +
            '<span><kbd>esc</kbd> to close</span>' +
          '</div>' +
          '<div class="mgnl-search-modal__branding">' + this._escapeHtml(this.options.branding) + '</div>' +
        '</div>';
    }
    
    modal.innerHTML = 
      '<div class="mgnl-search-modal__backdrop"></div>' +
      '<div class="mgnl-search-modal__container">' +
        '<div class="mgnl-search-modal__header">' +
          '<div class="mgnl-search-modal__input-wrap">' +
            '<svg class="mgnl-search-modal__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
              '<circle cx="11" cy="11" r="8"/>' +
              '<path d="M21 21l-4.35-4.35"/>' +
            '</svg>' +
            '<input ' +
              'type="text" ' +
              'class="mgnl-search-modal__input" ' +
              'placeholder="' + this._escapeHtml(this.options.placeholder) + '" ' +
              'autocomplete="off" ' +
              'autocorrect="off" ' +
              'autocapitalize="off" ' +
              'spellcheck="false" ' +
              'aria-label="Search input"' +
            '/>' +
            '<button type="button" class="mgnl-search-modal__clear" aria-label="Clear search" style="display: none;">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<path d="M18 6L6 18M6 6l12 12"/>' +
              '</svg>' +
            '</button>' +
            '<button type="button" class="mgnl-search-modal__close" aria-label="Close search">' +
              '<kbd>esc</kbd>' +
            '</button>' +
          '</div>' +
          (this.options.showFilters ? '<div class="mgnl-search-modal__filters"></div>' : '') +
        '</div>' +
        '<div class="mgnl-search-modal__body">' +
          '<div class="mgnl-search-results"></div>' +
        '</div>' +
        footerHtml +
      '</div>';
    
    document.body.appendChild(modal);
    this.modal = modal;
  };

  MagnoliaSearchUI.prototype._renderFilters = function() {
    if (!this.options.showFilters) return;
    
    var filtersContainer = this.modal.querySelector('.mgnl-search-modal__filters');
    if (!filtersContainer) return;
    
    var self = this;
    
    filtersContainer.innerHTML = this.filters.map(function(filter, index) {
      return '<button type="button" class="mgnl-search-filter' + (index === 0 ? ' active' : '') + '" data-filter="' + self._escapeHtml(filter.key) + '">' +
        self._escapeHtml(filter.label) +
      '</button>';
    }).join('');
    
    // Bind filter click events
    filtersContainer.querySelectorAll('.mgnl-search-filter').forEach(function(btn) {
      btn.addEventListener('click', function() {
        filtersContainer.querySelectorAll('.mgnl-search-filter').forEach(function(b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        self.currentFilter = btn.dataset.filter;
        
        var input = self.modal.querySelector('.mgnl-search-modal__input');
        self._performSearch(input.value);
      });
    });
  };

  MagnoliaSearchUI.prototype._bindEvents = function() {
    var self = this;
    
    // Backdrop click
    this.modal.querySelector('.mgnl-search-modal__backdrop').addEventListener('click', function() {
      self.close();
    });
    
    // Close button
    this.modal.querySelector('.mgnl-search-modal__close').addEventListener('click', function() {
      self.close();
    });
    
    // Input
    var input = this.modal.querySelector('.mgnl-search-modal__input');
    var clearButton = this.modal.querySelector('.mgnl-search-modal__clear');
    var debounceTimer;
    
    // Clear button handler
    clearButton.addEventListener('click', function() {
      input.value = '';
      input.focus();
      self._updateClearButtonVisibility('');
      self._performSearch('');
    });
    
    // Update clear button visibility on input
    input.addEventListener('input', function(e) {
      var value = e.target.value;
      self._updateClearButtonVisibility(value);
      
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        self._performSearch(value);
      }, self.options.debounceMs);
    });
    
    // Keyboard navigation
    input.addEventListener('keydown', function(e) {
      self._handleKeydown(e);
    });
    
    // Global hotkey
    document.addEventListener('keydown', function(e) {
      // Check if hotkey pressed and not in an input
      // Don't trigger if Command/Ctrl is pressed (those are for other shortcuts)
      if (e.key === self.options.hotkey && !self._isInputFocused() && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        self.open();
      }
      // Escape to close
      if (e.key === 'Escape' && self.isOpen) {
        self.close();
      }
    });
  };

  MagnoliaSearchUI.prototype._isInputFocused = function() {
    var active = document.activeElement;
    if (!active) return false;
    var tag = active.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable;
  };

  MagnoliaSearchUI.prototype.open = function() {
    var self = this;
    
    this.modal.classList.add('is-open');
    this.isOpen = true;
    
    // Lazy load search index when modal opens (saves bandwidth!)
    if (!this.search.loaded && !this.indexLoadFailed && !this.indexLoading) {
      this.indexLoading = true;
      var resultsContainer = this.modal.querySelector('.mgnl-search-results');
      resultsContainer.innerHTML = '<div class="mgnl-search-empty">Loading search index...</div>';
      
      this.search.load().then(function() {
        self.indexLoading = false;
        var input = self.modal.querySelector('.mgnl-search-modal__input');
        if (input.value) {
          self._performSearch(input.value);
        }
      }).catch(function(err) {
        console.warn('MagnoliaSearchUI: Failed to load search index:', err);
        self.indexLoadFailed = true;
        self.indexLoading = false;
        var resultsContainer = self.modal.querySelector('.mgnl-search-results');
        if (self.options.devMode) {
          resultsContainer.innerHTML = '<div class="mgnl-search-empty">Search index failed to load. Using dev mode.</div>';
        } else {
          resultsContainer.innerHTML = '<div class="mgnl-search-empty">Small issue rendering results. Give us a moment.</div>';
        }
      });
    }
    
    var input = this.modal.querySelector('.mgnl-search-modal__input');
    setTimeout(function() {
      input.focus();
    }, 50);
    
    document.body.style.overflow = 'hidden';
    
    if (this.options.onOpen) {
      this.options.onOpen();
    }
  };

  MagnoliaSearchUI.prototype.close = function() {
    this.modal.classList.remove('is-open');
    this.isOpen = false;
    
    document.body.style.overflow = '';
    
    // Clear results and input
    var input = this.modal.querySelector('.mgnl-search-modal__input');
    this.modal.querySelector('.mgnl-search-results').innerHTML = '';
    input.value = '';
    this.selectedIndex = 0;
    this._updateClearButtonVisibility('');
    
    if (this.options.onClose) {
      this.options.onClose();
    }
  };

  MagnoliaSearchUI.prototype._updateClearButtonVisibility = function(value) {
    var clearButton = this.modal.querySelector('.mgnl-search-modal__clear');
    if (clearButton) {
      clearButton.style.display = value && value.length > 0 ? 'block' : 'none';
    }
  };

  MagnoliaSearchUI.prototype._performSearch = function(query) {
    var resultsContainer = this.modal.querySelector('.mgnl-search-results');
    
    if (!query || query.length < this.options.minChars) {
      resultsContainer.innerHTML = '<div class="mgnl-search-empty">Type to search...</div>';
      return;
    }
    
    // Check if index load failed - show error in production, dummy results only in dev mode
    if (this.indexLoadFailed && !this.search.loaded) {
      if (this.options.devMode) {
        // Dev mode: show dummy results for styling work
        var dummyResults = this._getDummyResults(query);
        this.selectedIndex = 0;
        this._renderResults(dummyResults, query);
        return;
      } else {
        // Production: show error message
        resultsContainer.innerHTML = '<div class="mgnl-search-empty">Small issue rendering results. Give us a moment.</div>';
        return;
      }
    }
    
    // Index still loading (not failed yet)
    if (!this.search.loaded) {
      resultsContainer.innerHTML = '<div class="mgnl-search-empty">Loading search index...</div>';
      return;
    }
    
    var results = this.search.search(query, {
      version: this.currentFilter || null,
      maxResults: this.options.maxResults
    });
    
    if (results.length === 0) {
      resultsContainer.innerHTML = '<div class="mgnl-search-empty">No results found for "' + this._escapeHtml(query) + '"</div>';
      return;
    }
    
    this.selectedIndex = 0;
    this._renderResults(results, query);
  };

  MagnoliaSearchUI.prototype._renderResults = function(results, query) {
    var self = this;
    var resultsContainer = this.modal.querySelector('.mgnl-search-results');
    
    resultsContainer.innerHTML = results.map(function(result, index) {
      var headingHtml = '';
      if (result.heading && result.heading !== result.title) {
        headingHtml = '<div class="mgnl-search-result__heading">' + self.search.highlight(result.heading, query) + '</div>';
      }
      
      return '<a href="' + self._escapeHtml(result.url) + '" class="mgnl-search-result' + (index === 0 ? ' is-selected' : '') + '" data-index="' + index + '">' +
        '<div class="mgnl-search-result__category">' + self._escapeHtml(result.category || '') + '</div>' +
        '<div class="mgnl-search-result__title">' + self.search.highlight(result.title, query) + '</div>' +
        headingHtml +
        '<div class="mgnl-search-result__content">' + self.search.highlight(result.content, query) + '</div>' +
      '</a>';
    }).join('');
    
    // Add click handlers
    resultsContainer.querySelectorAll('.mgnl-search-result').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (self.options.onResultClick) {
          var index = parseInt(el.dataset.index, 10);
          self.options.onResultClick(results[index], e);
        }
        self.close();
      });
    });
  };

  MagnoliaSearchUI.prototype._handleKeydown = function(e) {
    var results = this.modal.querySelectorAll('.mgnl-search-result');
    if (results.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, results.length - 1);
      this._updateSelection(results);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this._updateSelection(results);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      var selected = results[this.selectedIndex];
      if (selected) {
        selected.click();
      }
    }
  };

  MagnoliaSearchUI.prototype._updateSelection = function(results) {
    var self = this;
    results.forEach(function(r, i) {
      if (i === self.selectedIndex) {
        r.classList.add('is-selected');
        r.scrollIntoView({ block: 'nearest' });
      } else {
        r.classList.remove('is-selected');
      }
    });
  };

  MagnoliaSearchUI.prototype._escapeHtml = function(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  /**
   * Generate dummy results for development/styling purposes
   */
  MagnoliaSearchUI.prototype._getDummyResults = function(query) {
    var queryLower = query.toLowerCase();
    var maxResults = this.options.maxResults || 15;
    
    // Sample results that match various scenarios
    var dummyResults = [
      {
        id: 'dummy-1',
        url: '#getting-started',
        title: 'Getting Started with Magnolia',
        heading: 'Introduction',
        headingLevel: 2,
        content: 'Learn how to get started with Magnolia CMS. This guide covers installation, configuration, and your first steps with the platform.',
        category: 'Latest',
        version: 'latest',
        breadcrumb: ['Documentation', 'Getting Started']
      },
      {
        id: 'dummy-2',
        url: '#templating',
        title: 'Templating in Magnolia',
        heading: 'Template Development',
        headingLevel: 2,
        content: 'Create and customize templates for your Magnolia site. Learn about template types, component development, and best practices.',
        category: 'Latest',
        version: 'latest',
        breadcrumb: ['Documentation', 'Templating']
      },
      {
        id: 'dummy-3',
        url: '#rest-api',
        title: 'REST API Documentation',
        heading: 'API Endpoints',
        headingLevel: 2,
        content: 'Complete reference for the Magnolia REST API. Includes authentication, endpoints, request/response formats, and examples.',
        category: 'Modules',
        version: 'modules',
        breadcrumb: ['Documentation', 'REST API']
      },
      {
        id: 'dummy-4',
        url: '#content-modeling',
        title: 'Content Modeling',
        heading: 'Defining Content Types',
        headingLevel: 2,
        content: 'Understand how to model your content in Magnolia. Learn about content types, definitions, and structuring your content architecture.',
        category: 'Latest',
        version: 'latest',
        breadcrumb: ['Documentation', 'Content Modeling']
      },
      {
        id: 'dummy-5',
        url: '#user-management',
        title: 'User Management and Permissions',
        heading: 'Managing Users',
        headingLevel: 2,
        content: 'Configure users, roles, and permissions in Magnolia. Set up access control and manage user accounts effectively.',
        category: '6.3',
        version: '6.3',
        breadcrumb: ['Documentation', 'Administration']
      },
      {
        id: 'dummy-6',
        url: '#modules-overview',
        title: 'Magnolia Modules Overview',
        heading: 'Available Modules',
        headingLevel: 1,
        content: 'Explore the wide range of modules available for Magnolia CMS. Each module extends functionality and adds new capabilities to your site.',
        category: 'Modules',
        version: 'modules',
        breadcrumb: ['Documentation', 'Modules']
      },
      {
        id: 'dummy-7',
        url: '#cloud-deployment',
        title: 'Deploying to Magnolia Cloud',
        heading: 'Cloud Setup',
        headingLevel: 2,
        content: 'Deploy your Magnolia site to Magnolia Cloud. Learn about cloud-specific configuration, deployment processes, and best practices.',
        category: 'Cloud',
        version: 'cloud',
        breadcrumb: ['Documentation', 'Cloud']
      },
      {
        id: 'dummy-8',
        url: '#version-6-2',
        title: 'Magnolia 6.2 Documentation',
        heading: 'What\'s New',
        headingLevel: 2,
        content: 'Discover the new features and improvements in Magnolia 6.2. This version includes enhanced performance and new capabilities.',
        category: '6.2',
        version: '6.2',
        breadcrumb: ['Documentation', 'Version 6.2']
      },
      {
        id: 'dummy-9',
        url: '#workflow',
        title: 'Content Workflow Configuration',
        heading: 'Setting Up Workflows',
        headingLevel: 2,
        content: 'Configure content approval workflows in Magnolia. Set up review processes, approval chains, and content publishing workflows.',
        category: 'Latest',
        version: 'latest',
        breadcrumb: ['Documentation', 'Workflow']
      },
      {
        id: 'dummy-10',
        url: '#search-configuration',
        title: 'Search Configuration',
        heading: 'Configuring Search',
        headingLevel: 2,
        content: 'Configure and customize search functionality in Magnolia. Set up search indexes, configure search behavior, and optimize search performance.',
        category: 'Latest',
        version: 'latest',
        breadcrumb: ['Documentation', 'Search']
      },
      {
        id: 'dummy-11',
        url: '#theming',
        title: 'Customizing Themes',
        heading: 'Theme Development',
        headingLevel: 2,
        content: 'Create and customize themes for your Magnolia site. Learn about CSS variables, theme structure, and styling best practices.',
        category: 'Latest',
        version: 'latest',
        breadcrumb: ['Documentation', 'Theming']
      },
      {
        id: 'dummy-12',
        url: '#performance',
        title: 'Performance Optimization',
        heading: 'Optimizing Performance',
        headingLevel: 2,
        content: 'Optimize your Magnolia site for better performance. Learn about caching strategies, performance tuning, and optimization techniques.',
        category: 'Latest',
        version: 'latest',
        breadcrumb: ['Documentation', 'Performance']
      }
    ];
    
    // Filter by version if a filter is active
    var filtered = dummyResults;
    if (this.currentFilter) {
      filtered = dummyResults.filter(function(result) {
        return result.version === this.currentFilter;
      }.bind(this));
    }
    
    // If no results match the filter, show all (for dev purposes)
    if (filtered.length === 0) {
      filtered = dummyResults;
    }
    
    // Score and sort by relevance to query
    var self = this;
    var scored = filtered.map(function(result) {
      var score = self._scoreDummyResult(result, queryLower);
      return {
        result: result,
        score: score
      };
    });
    
    // Sort by score descending
    scored.sort(function(a, b) {
      return b.score - a.score;
    });
    
    // Extract results and limit to maxResults
    return scored.map(function(item) {
      return item.result;
    }).slice(0, maxResults);
  };

  /**
   * Score a dummy result against the query for relevance ordering
   */
  MagnoliaSearchUI.prototype._scoreDummyResult = function(result, queryLower) {
    var score = 0;
    var queryTokens = queryLower.split(/\s+/).filter(function(token) {
      return token.length >= 2;
    });
    
    if (queryTokens.length === 0) return 0;
    
    var titleLower = (result.title || '').toLowerCase();
    var headingLower = (result.heading || '').toLowerCase();
    var contentLower = (result.content || '').toLowerCase();
    var categoryLower = (result.category || '').toLowerCase();
    
    // Exact phrase match bonus
    if (titleLower.indexOf(queryLower) !== -1) {
      score += 100;
    }
    if (headingLower.indexOf(queryLower) !== -1) {
      score += 80;
    }
    if (contentLower.indexOf(queryLower) !== -1) {
      score += 30;
    }
    
    // Token matches
    for (var i = 0; i < queryTokens.length; i++) {
      var token = queryTokens[i];
      
      if (titleLower.indexOf(token) !== -1) {
        score += 50;
      }
      if (headingLower.indexOf(token) !== -1) {
        score += 40;
      }
      if (contentLower.indexOf(token) !== -1) {
        score += 10;
      }
      if (categoryLower.indexOf(token) !== -1) {
        score += 20;
      }
    }
    
    // Boost for h1 headings
    if (result.headingLevel === 1) {
      score *= 1.2;
    }
    
    return score;
  };

  // Public API methods
  MagnoliaSearchUI.prototype.setFilter = function(filterKey) {
    this.currentFilter = filterKey;
    
    // Update UI
    var filtersContainer = this.modal.querySelector('.mgnl-search-modal__filters');
    if (filtersContainer) {
      filtersContainer.querySelectorAll('.mgnl-search-filter').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.filter === filterKey);
      });
    }
  };

  MagnoliaSearchUI.prototype.destroy = function() {
    if (this.modal) {
      this.modal.remove();
    }
    var container = document.querySelector(this.options.container);
    if (container) {
      container.innerHTML = '';
    }
  };

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MagnoliaSearchUI;
  } else {
    global.MagnoliaSearchUI = MagnoliaSearchUI;
  }

})(typeof window !== 'undefined' ? window : this);
