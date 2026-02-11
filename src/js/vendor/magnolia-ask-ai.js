/* eslint-disable */
/**
 * Magnolia Docs AI Assistant
 * 
 * Provides AI-powered answers using:
 * - Semantic search over LLM-optimized chunks
 * - Context retrieval for accurate responses
 * - Streaming responses
 * 
 * ES5 compatible for UglifyJS
 */

(function(global) {
  'use strict';

  function MagnoliaAI(options) {
    options = options || {};
    this.chunksUrl = options.chunksUrl || '/search-data/llm-chunks.json';
    this.apiEndpoint = options.apiEndpoint || '/api/ask'; // Your backend endpoint
    this.apiKey = options.apiKey || null; // If calling provider directly (not recommended)
    this.provider = options.provider || 'anthropic'; // 'anthropic' | 'openai'
    
    this.chunks = [];
    this.loaded = false;
    
    // Configuration
    this.config = {
      maxContextChunks: 5,        // Max chunks to include in context
      maxContextTokens: 8000,     // Max tokens for context
      minRelevanceScore: 0.3,     // Minimum relevance to include
    };
    
    // Simple keyword-based embedding (for POC - use real embeddings in production)
    this.chunkKeywords = [];
  }

  /**
   * Load LLM chunks
   */
  MagnoliaAI.prototype.load = function() {
    var self = this;
    
    if (this.loaded) {
      return Promise.resolve();
    }
    
    return fetch(this.chunksUrl)
      .then(function(response) {
        if (!response.ok) throw new Error('Failed to load LLM chunks');
        return response.json();
      })
      .then(function(data) {
        self.chunks = data;
        self.loaded = true;
        
        // Pre-compute keywords for each chunk
        self._buildKeywordIndex();
        
        console.log('MagnoliaAI: Loaded ' + self.chunks.length + ' chunks');
      })
      .catch(function(err) {
        console.error('MagnoliaAI: Failed to load chunks', err);
        throw err;
      });
  };

  /**
   * Build keyword index for similarity matching
   */
  MagnoliaAI.prototype._buildKeywordIndex = function() {
    var self = this;
    this.chunkKeywords = this.chunks.map(function(chunk) {
      var text = (chunk.title + ' ' + chunk.content).toLowerCase();
      return self._extractKeywords(text);
    });
  };

  /**
   * Extract keywords from text
   */
  MagnoliaAI.prototype._extractKeywords = function(text) {
    // Remove common words and extract meaningful terms
    var stopwords = {
      'the': true, 'a': true, 'an': true, 'and': true, 'or': true, 'but': true, 'in': true, 'on': true, 'at': true, 'to': true, 'for': true,
      'of': true, 'with': true, 'by': true, 'from': true, 'as': true, 'is': true, 'was': true, 'are': true, 'were': true, 'been': true,
      'be': true, 'have': true, 'has': true, 'had': true, 'do': true, 'does': true, 'did': true, 'will': true, 'would': true,
      'could': true, 'should': true, 'may': true, 'might': true, 'must': true, 'can': true, 'this': true, 'that': true,
      'these': true, 'those': true, 'it': true, 'its': true, 'you': true, 'your': true, 'we': true, 'our': true, 'they': true,
      'their': true, 'which': true, 'what': true, 'who': true, 'when': true, 'where': true, 'how': true, 'all': true,
      'each': true, 'every': true, 'both': true, 'few': true, 'more': true, 'most': true, 'other': true, 'some': true,
      'such': true, 'no': true, 'not': true, 'only': true, 'same': true, 'so': true, 'than': true, 'too': true, 'very': true
    };
    
    var words = text
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(function(word) {
        return word.length >= 3 && !stopwords[word];
      });
    
    // Count frequency
    var freq = {};
    words.forEach(function(word) {
      freq[word] = (freq[word] || 0) + 1;
    });
    
    // Return unique keywords sorted by frequency
    return Object.keys(freq)
      .map(function(word) {
        return [word, freq[word]];
      })
      .sort(function(a, b) {
        return b[1] - a[1];
      })
      .slice(0, 50)
      .map(function(item) {
        return item[0];
      });
  };

  /**
   * Find relevant chunks for a question
   */
  MagnoliaAI.prototype.findRelevantChunks = function(question, options) {
    options = options || {};
    var self = this;
    
    if (!this.loaded) {
      throw new Error('MagnoliaAI: Chunks not loaded');
    }
    
    var maxChunks = options.maxChunks || this.config.maxContextChunks;
    var filter = options.filter || {};
    
    var queryKeywords = this._extractKeywords(question.toLowerCase());
    
    // Score each chunk
    var scored = this.chunks.map(function(chunk, index) {
      // Apply filters
      if (filter.version && chunk.version !== filter.version) {
        return null;
      }
      if (filter.category && chunk.category !== filter.category) {
        return null;
      }
      
      // Calculate similarity score
      var chunkKw = self.chunkKeywords[index];
      var score = self._calculateSimilarity(queryKeywords, chunkKw, chunk, question);
      
      return { chunk: chunk, score: score };
    }).filter(function(item) {
      return item !== null;
    });
    
    // Sort by score and return top chunks
    scored.sort(function(a, b) {
      return b.score - a.score;
    });
    
    var results = scored
      .filter(function(item) {
        return item.score >= self.config.minRelevanceScore;
      })
      .slice(0, maxChunks);
    
    return results;
  };

  /**
   * Calculate similarity between query and chunk
   */
  MagnoliaAI.prototype._calculateSimilarity = function(queryKeywords, chunkKeywords, chunk, question) {
    var questionLower = question.toLowerCase();
    var titleLower = chunk.title.toLowerCase();
    var contentLower = chunk.content.toLowerCase();
    
    var score = 0;
    
    // Title exact match
    if (titleLower.indexOf(questionLower) !== -1) {
      score += 50;
    }
    
    // Keyword overlap
    var chunkSet = {};
    chunkKeywords.forEach(function(kw) {
      chunkSet[kw] = true;
    });
    
    var matchCount = 0;
    var self = this;
    
    queryKeywords.forEach(function(keyword) {
      if (chunkSet[keyword]) {
        matchCount++;
        // Bonus for title keyword match
        if (titleLower.indexOf(keyword) !== -1) {
          score += 5;
        }
      }
      // Partial/prefix match
      chunkKeywords.forEach(function(ck) {
        if (ck.indexOf(keyword) === 0 || keyword.indexOf(ck) === 0) {
          matchCount += 0.5;
        }
      });
    });
    
    // Jaccard-like similarity
    var unionSet = {};
    queryKeywords.forEach(function(kw) {
      unionSet[kw] = true;
    });
    chunkKeywords.forEach(function(kw) {
      unionSet[kw] = true;
    });
    var union = Object.keys(unionSet).length;
    score += (matchCount / union) * 100;
    
    // Boost for shorter chunks (more specific)
    if (chunk.tokenEstimate < 500) {
      score *= 1.1;
    }
    
    return score;
  };

  /**
   * Build context from relevant chunks
   */
  MagnoliaAI.prototype.buildContext = function(relevantChunks) {
    var context = '';
    var totalTokens = 0;
    var self = this;
    
    var chunks = relevantChunks.map(function(r) {
      return r.chunk;
    });
    
    for (var i = 0; i < chunks.length; i++) {
      var chunk = chunks[i];
      if (totalTokens + chunk.tokenEstimate > this.config.maxContextTokens) {
        break;
      }
      
      context += '\n\n---\n\n' + chunk.content;
      totalTokens += chunk.tokenEstimate;
    }
    
    return {
      context: context.trim(),
      tokenEstimate: totalTokens,
      sources: chunks.map(function(c) {
        return { title: c.title, url: c.url };
      })
    };
  };

  /**
   * Ask a question (requires backend or direct API access)
   */
  MagnoliaAI.prototype.ask = function(question, options) {
    options = options || {};
    var self = this;
    
    if (!this.loaded) {
      return this.load().then(function() {
        return self.ask(question, options);
      });
    }
    
    // Find relevant context
    var relevantChunks = this.findRelevantChunks(question, {
      maxChunks: options.maxChunks || this.config.maxContextChunks,
      filter: options.filter || {}
    });
    
    if (relevantChunks.length === 0) {
      return Promise.resolve({
        answer: "I couldn't find relevant documentation to answer your question. Try rephrasing or being more specific.",
        sources: [],
        context: null
      });
    }
    
    var contextData = this.buildContext(relevantChunks);
    var context = contextData.context;
    var sources = contextData.sources;
    
    // Build prompt
    var systemPrompt = 'You are a helpful assistant for Magnolia CMS documentation. \n' +
      'Answer questions based ONLY on the provided documentation context.\n' +
      'If the context doesn\'t contain enough information to fully answer, say so.\n' +
      'Always cite specific pages when possible.\n' +
      'Be concise but thorough.';
    
    var userPrompt = 'Documentation Context:\n' +
      context + '\n\n' +
      '---\n\n' +
      'Question: ' + question + '\n\n' +
      'Please answer based on the documentation above. Cite relevant pages.';

    // If using backend endpoint
    if (this.apiEndpoint && !this.apiKey) {
      return fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question,
          context: context,
          sources: sources,
          systemPrompt: systemPrompt,
          userPrompt: userPrompt
        })
      })
      .then(function(response) {
        if (!response.ok) {
          throw new Error('Failed to get AI response');
        }
        return response.json();
      })
      .then(function(data) {
        return {
          answer: data.answer,
          sources: sources,
          context: context
        };
      });
    }
    
    // Direct API call (for testing only - don't expose API keys in frontend!)
    if (this.apiKey) {
      return this._callLLMDirect(systemPrompt, userPrompt).then(function(answer) {
        return {
          answer: answer,
          sources: sources,
          context: context
        };
      });
    }
    
    // No API configured - return context for manual use
    return Promise.resolve({
      answer: null,
      sources: sources,
      context: context,
      prompt: userPrompt,
      systemPrompt: systemPrompt
    });
  };

  /**
   * Direct LLM call (for development/testing only)
   */
  MagnoliaAI.prototype._callLLMDirect = function(systemPrompt, userPrompt) {
    var self = this;
    
    if (this.provider === 'anthropic') {
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        })
      })
      .then(function(response) {
        return response.json();
      })
      .then(function(data) {
        return data.content[0].text;
      });
    }
    
    if (this.provider === 'openai') {
      return fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.apiKey
        },
        body: JSON.stringify({
          model: 'gpt-4-turbo-preview',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 1024
        })
      })
      .then(function(response) {
        return response.json();
      })
      .then(function(data) {
        return data.choices[0].message.content;
      });
    }
    
    return Promise.reject(new Error('Unknown provider: ' + this.provider));
  };

  /**
   * Stream a response (if using backend with streaming support)
   * Note: Generators not supported in ES5, so this is a placeholder
   */
  MagnoliaAI.prototype.askStream = function(question, options) {
    // Streaming not implemented in ES5 version
    // Use regular ask() method instead
    return Promise.reject(new Error('Streaming not supported in ES5 version'));
  };

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MagnoliaAI;
  } else {
    global.MagnoliaAI = MagnoliaAI;
  }

})(typeof window !== 'undefined' ? window : this);
/**
 * Magnolia Docs Ask AI UI
 * 
 * A fully decoupled, drop-in AI assistant widget with:
 * - Modal dialog for questions
 * - AI-powered answers from documentation
 * - Version filtering
 * - Rate limiting (per session)
 * - Configurable positioning
 * - Keyboard shortcuts
 * - No external dependencies
 * 
 * Usage:
 *   new MagnoliaAskAIUI({
 *     container: '#askAI',
 *     chunksUrl: '/search-data/llm-chunks.json',
 *     apiEndpoint: '/api/ask',
 *     enabled: true,
 *     position: 'header'
 *   });
 */

(function(global) {
  'use strict';

  // Default filter configuration
  var DEFAULT_FILTERS = [
    { key: '', label: 'All' },
    { key: 'latest', label: 'Latest' },
    { key: '6.3', label: '6.3' },
    { key: '6.2', label: '6.2' },
    { key: 'cloud', label: 'DX Cloud' },
    { key: 'modules', label: 'Modules' }
  ];

  function MagnoliaAskAIUI(options) {
    options = options || {};
    
    this.options = {
      container: options.container || '#askAI',
      chunksUrl: options.chunksUrl || '/search-data/llm-chunks.json',
      apiEndpoint: options.apiEndpoint || '/api/ask',
      placeholder: options.placeholder || 'Ask a question about Magnolia...',
      hotkey: options.hotkey || '?',
      enabled: options.enabled !== undefined ? options.enabled : false,
      position: options.position || 'header', // 'header' | 'bottom-left' | 'bottom-right'
      showFilters: options.showFilters !== false,
      showFooter: options.showFooter !== false,
      branding: options.branding || 'Powered by Magnolia AI',
      maxQuestionsPerSession: options.maxQuestionsPerSession || 12,
      maxContextChunks: options.maxContextChunks || 5,
      maxContextTokens: options.maxContextTokens || 8000,
      filters: options.filters || DEFAULT_FILTERS,
      onAnswer: options.onAnswer || null,
      onOpen: options.onOpen || null,
      onClose: options.onClose || null
    };
    
    this.ai = null;
    this.modal = null;
    this.currentFilter = '';
    this.isOpen = false;
    this.questionsAsked = 0;
    this.isLoading = false;
    
    // Initialize only if enabled
    if (this.options.enabled) {
      this._init();
    }
  }

  MagnoliaAskAIUI.prototype._init = function() {
    var self = this;
    
    // Check if MagnoliaAI is available
    if (typeof MagnoliaAI === 'undefined') {
      console.error('MagnoliaAskAIUI: MagnoliaAI not found. Include ai-assistant.js first.');
      return;
    }
    
    // Initialize AI assistant
    this.ai = new MagnoliaAI({
      chunksUrl: this.options.chunksUrl,
      apiEndpoint: this.options.apiEndpoint
    });
    
    // Load questions asked count from sessionStorage
    this._loadSessionState();
    
    // Create UI elements
    this._createTrigger();
    this._createModal();
    this._bindEvents();
    
    // NOTE: Chunks are now loaded lazily when user opens Ask AI modal (saves bandwidth!)
  };

  MagnoliaAskAIUI.prototype._loadSessionState = function() {
    try {
      var stored = sessionStorage.getItem('mgnl-ask-ai-questions');
      if (stored) {
        this.questionsAsked = parseInt(stored, 10) || 0;
      }
    } catch (e) {
      // sessionStorage not available, ignore
    }
  };

  MagnoliaAskAIUI.prototype._saveSessionState = function() {
    try {
      sessionStorage.setItem('mgnl-ask-ai-questions', this.questionsAsked.toString());
    } catch (e) {
      // sessionStorage not available, ignore
    }
  };

  MagnoliaAskAIUI.prototype._loadChunks = function() {
    var self = this;
    
    this.ai.load().catch(function(err) {
      console.warn('MagnoliaAskAIUI: Failed to load chunks:', err);
    });
  };

  MagnoliaAskAIUI.prototype._createTrigger = function() {
    var container = document.querySelector(this.options.container);
    if (!container) {
      console.warn('MagnoliaAskAIUI: Container not found:', this.options.container);
      return;
    }
    
    var self = this;
    var positionClass = 'mgnl-ask-ai-trigger--' + this.options.position;
    
    // Always show '?' on button (universal symbol), but actual shortcut varies by OS
    container.innerHTML = 
      '<button type="button" class="mgnl-ask-ai-trigger ' + positionClass + '" aria-label="Ask AI">' +
        '<svg class="mgnl-ask-ai-trigger__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
          '<path d="M13 8H3M17 12H3M15 16H3"/>' +
        '</svg>' +
        '<span class="mgnl-ask-ai-trigger__text">Ask AI</span>' +
        '<kbd class="mgnl-ask-ai-trigger__kbd">' + this._escapeHtml(this.options.hotkey) + '</kbd>' +
      '</button>';
    
    container.querySelector('.mgnl-ask-ai-trigger').addEventListener('click', function() {
      self.open();
    });
  };

  MagnoliaAskAIUI.prototype._createModal = function() {
    // Remove existing modal if any
    var existing = document.querySelector('.mgnl-ask-ai-modal');
    if (existing) existing.remove();
    
    var modal = document.createElement('div');
    modal.className = 'mgnl-ask-ai-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Ask AI');
    
    var footerHtml = '';
    if (this.options.showFooter) {
      footerHtml = 
        '<div class="mgnl-ask-ai-modal__footer">' +
          '<div class="mgnl-ask-ai-modal__hints">' +
            '<span><kbd>↵</kbd> to ask</span>' +
            '<span><kbd>esc</kbd> to close</span>' +
          '</div>' +
          '<div class="mgnl-ask-ai-modal__branding">' + this._escapeHtml(this.options.branding) + '</div>' +
        '</div>';
    }
    
    modal.innerHTML = 
      '<div class="mgnl-ask-ai-modal__backdrop"></div>' +
      '<div class="mgnl-ask-ai-modal__container">' +
        '<div class="mgnl-ask-ai-modal__header">' +
          '<div class="mgnl-ask-ai-modal__input-wrap">' +
            '<svg class="mgnl-ask-ai-modal__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
              '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
            '</svg>' +
            '<textarea ' +
              'class="mgnl-ask-ai-modal__input" ' +
              'placeholder="' + this._escapeHtml(this.options.placeholder) + '" ' +
              'rows="1" ' +
              'aria-label="Question input"' +
            '></textarea>' +
            '<button type="button" class="mgnl-ask-ai-modal__submit" aria-label="Ask question">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>' +
              '</svg>' +
            '</button>' +
            '<button type="button" class="mgnl-ask-ai-modal__close" aria-label="Close">' +
              '<kbd>esc</kbd>' +
            '</button>' +
          '</div>' +
          (this.options.showFilters ? '<div class="mgnl-ask-ai-modal__filters"></div>' : '') +
          '<div class="mgnl-ask-ai-modal__rate-limit"></div>' +
        '</div>' +
        '<div class="mgnl-ask-ai-modal__body">' +
          '<div class="mgnl-ask-ai-content"></div>' +
        '</div>' +
        footerHtml +
      '</div>';
    
    document.body.appendChild(modal);
    this.modal = modal;
    
    // Render filters
    if (this.options.showFilters) {
      this._renderFilters();
    }
    
    // Update rate limit display
    this._updateRateLimitDisplay();
  };

  MagnoliaAskAIUI.prototype._renderFilters = function() {
    if (!this.options.showFilters) return;
    
    var filtersContainer = this.modal.querySelector('.mgnl-ask-ai-modal__filters');
    if (!filtersContainer) return;
    
    var self = this;
    
    filtersContainer.innerHTML = this.options.filters.map(function(filter, index) {
      return '<button type="button" class="mgnl-ask-ai-filter' + (index === 0 ? ' active' : '') + '" data-filter="' + self._escapeHtml(filter.key) + '">' +
        self._escapeHtml(filter.label) +
      '</button>';
    }).join('');
    
    // Bind filter click events
    filtersContainer.querySelectorAll('.mgnl-ask-ai-filter').forEach(function(btn) {
      btn.addEventListener('click', function() {
        filtersContainer.querySelectorAll('.mgnl-ask-ai-filter').forEach(function(b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        self.currentFilter = btn.dataset.filter;
      });
    });
  };

  MagnoliaAskAIUI.prototype._updateRateLimitDisplay = function() {
    var rateLimitContainer = this.modal.querySelector('.mgnl-ask-ai-modal__rate-limit');
    if (!rateLimitContainer) return;
    
    var remaining = Math.max(0, this.options.maxQuestionsPerSession - this.questionsAsked);
    
    if (remaining === 0) {
      rateLimitContainer.innerHTML = '<span class="mgnl-ask-ai-rate-limit--exceeded">Rate limit reached. Please refresh the page.</span>';
      rateLimitContainer.classList.add('is-exceeded');
    } else {
      rateLimitContainer.innerHTML = '<span class="mgnl-ask-ai-rate-limit">Questions remaining: ' + remaining + ' / ' + this.options.maxQuestionsPerSession + '</span>';
      rateLimitContainer.classList.remove('is-exceeded');
    }
  };

  MagnoliaAskAIUI.prototype._bindEvents = function() {
    var self = this;
    
    // Backdrop click
    this.modal.querySelector('.mgnl-ask-ai-modal__backdrop').addEventListener('click', function() {
      self.close();
    });
    
    // Close button
    this.modal.querySelector('.mgnl-ask-ai-modal__close').addEventListener('click', function() {
      self.close();
    });
    
    // Submit button
    var submitButton = this.modal.querySelector('.mgnl-ask-ai-modal__submit');
    submitButton.addEventListener('click', function() {
      self._askQuestion();
    });
    
    // Textarea
    var textarea = this.modal.querySelector('.mgnl-ask-ai-modal__input');
    
    // Auto-resize textarea
    textarea.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = (this.scrollHeight) + 'px';
    });
    
    // Enter to submit (Shift+Enter for new line)
    textarea.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        self._askQuestion();
      }
    });
    
    // Global hotkey
    document.addEventListener('keydown', function(e) {
      // Check if hotkey pressed and not in an input
      var isHotkey = false;
      
      if (self.options.hotkey === '?') {
        // Support multiple ways to trigger '?':
        // 1. Command+/ (Mac standard for help/shortcuts)
        // 2. Ctrl+/ (Windows/Linux)
        // 3. Shift+/ (produces '?' character)
        // 4. Direct '?' key (if available)
        var isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        if (isMac) {
          // Mac: Command+/ is more standard than Shift+/
          isHotkey = (e.key === '/' && (e.metaKey || e.ctrlKey));
        } else {
          // Windows/Linux: Ctrl+/ or Shift+/
          isHotkey = ((e.key === '/' && e.ctrlKey) || (e.key === '/' && e.shiftKey));
        }
        // Also check for direct '?' key
        if (!isHotkey) {
          isHotkey = (e.key === '?');
        }
      } else {
        isHotkey = (e.key === self.options.hotkey);
      }
      
      if (isHotkey && !self._isInputFocused()) {
        e.preventDefault();
        self.open();
      }
      // Escape to close
      if (e.key === 'Escape' && self.isOpen) {
        self.close();
      }
    });
  };

  MagnoliaAskAIUI.prototype._isInputFocused = function() {
    var active = document.activeElement;
    if (!active) return false;
    var tag = active.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable;
  };

  MagnoliaAskAIUI.prototype._askQuestion = function() {
    var textarea = this.modal.querySelector('.mgnl-ask-ai-modal__input');
    var question = textarea.value.trim();
    
    if (!question) return;
    
    // Check rate limit
    if (this.questionsAsked >= this.options.maxQuestionsPerSession) {
      this._showError('Rate limit reached. Please refresh the page to ask more questions.');
      return;
    }
    
    // Check if AI is loaded
    if (!this.ai || !this.ai.loaded) {
      this._showError('AI assistant is still loading. Please wait a moment.');
      return;
    }
    
    if (this.isLoading) return; // Prevent multiple simultaneous requests
    
    this.isLoading = true;
    this.questionsAsked++;
    this._saveSessionState();
    this._updateRateLimitDisplay();
    
    // Show loading state
    this._showLoading(question);
    
    var self = this;
    var filter = this.currentFilter ? { version: this.currentFilter } : {};
    
    // Ask question
    this.ai.ask(question, {
      maxChunks: this.options.maxContextChunks,
      filter: filter
    }).then(function(response) {
      self.isLoading = false;
      
      if (response.answer) {
        self._showAnswer(response.answer, response.sources || []);
        
        if (self.options.onAnswer) {
          self.options.onAnswer(response);
        }
      } else {
        self._showError('Unable to get an answer. Please try rephrasing your question.');
      }
    }).catch(function(err) {
      self.isLoading = false;
      console.error('MagnoliaAskAIUI: Error asking question:', err);
      self._showError('An error occurred. Please try again.');
    });
  };

  MagnoliaAskAIUI.prototype._showLoading = function(question) {
    var contentContainer = this.modal.querySelector('.mgnl-ask-ai-content');
    contentContainer.innerHTML = 
      '<div class="mgnl-ask-ai-question">' +
        '<div class="mgnl-ask-ai-question__label">Question:</div>' +
        '<div class="mgnl-ask-ai-question__text">' + this._escapeHtml(question) + '</div>' +
      '</div>' +
      '<div class="mgnl-ask-ai-loading">' +
        '<div class="mgnl-ask-ai-loading__spinner"></div>' +
        '<div class="mgnl-ask-ai-loading__text">Finding relevant documentation...</div>' +
      '</div>';
  };

  MagnoliaAskAIUI.prototype._showAnswer = function(answer, sources) {
    var contentContainer = this.modal.querySelector('.mgnl-ask-ai-content');
    var self = this;
    
    var sourcesHtml = '';
    if (sources && sources.length > 0) {
      sourcesHtml = 
        '<div class="mgnl-ask-ai-sources">' +
          '<div class="mgnl-ask-ai-sources__label">Sources:</div>' +
          '<div class="mgnl-ask-ai-sources__list">' +
            sources.map(function(source) {
              return '<a href="' + self._escapeHtml(source.url) + '" target="_blank" class="mgnl-ask-ai-source">' +
                self._escapeHtml(source.title) +
              '</a>';
            }).join('') +
          '</div>' +
        '</div>';
    }
    
    contentContainer.innerHTML = 
      '<div class="mgnl-ask-ai-answer">' +
        '<div class="mgnl-ask-ai-answer__text">' + this._formatAnswer(answer) + '</div>' +
      '</div>' +
      sourcesHtml;
  };

  MagnoliaAskAIUI.prototype._showError = function(message) {
    var contentContainer = this.modal.querySelector('.mgnl-ask-ai-content');
    contentContainer.innerHTML = 
      '<div class="mgnl-ask-ai-error">' +
        '<div class="mgnl-ask-ai-error__icon">⚠</div>' +
        '<div class="mgnl-ask-ai-error__text">' + this._escapeHtml(message) + '</div>' +
      '</div>';
  };

  MagnoliaAskAIUI.prototype._formatAnswer = function(answer) {
    if (!answer) return '';
    
    var self = this;
    
    // Escape HTML first
    var escaped = this._escapeHtml(answer);
    
    // Convert markdown links to HTML (after escaping)
    escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(match, text, url) {
      return '<a href="' + self._escapeHtml(url) + '" target="_blank" rel="noopener">' + self._escapeHtml(text) + '</a>';
    });
    
    // Convert double line breaks to paragraphs
    var paragraphs = escaped.split(/\n\n+/).filter(function(para) {
      return para.trim().length > 0;
    });
    
    if (paragraphs.length === 0) {
      // Single paragraph, convert single line breaks to <br>
      escaped = escaped.replace(/\n/g, '<br>');
      return '<p>' + escaped + '</p>';
    }
    
    // Multiple paragraphs
    return paragraphs.map(function(para) {
      // Convert single line breaks to <br>
      para = para.replace(/\n/g, '<br>');
      return '<p>' + para + '</p>';
    }).join('');
  };

  MagnoliaAskAIUI.prototype.open = function() {
    if (!this.options.enabled) return;
    
    var self = this;
    
    this.modal.classList.add('is-open');
    this.isOpen = true;
    
    // Lazy load chunks when modal opens (saves bandwidth!)
    if (!this.ai.loaded && !this.chunksLoading) {
      this.chunksLoading = true;
      var contentContainer = this.modal.querySelector('.mgnl-ask-ai-content');
      contentContainer.innerHTML = 
        '<div class="mgnl-ask-ai-loading">' +
          '<div class="mgnl-ask-ai-loading__spinner"></div>' +
          '<div class="mgnl-ask-ai-loading__text">Loading AI assistant...</div>' +
        '</div>';
      
      this.ai.load().then(function() {
        self.chunksLoading = false;
        contentContainer.innerHTML = '';
      }).catch(function(err) {
        console.warn('MagnoliaAskAIUI: Failed to load chunks:', err);
        self.chunksLoading = false;
        contentContainer.innerHTML = 
          '<div class="mgnl-ask-ai-error">' +
            '<div class="mgnl-ask-ai-error__icon">⚠</div>' +
            '<div class="mgnl-ask-ai-error__text">Failed to load AI assistant. Please refresh the page.</div>' +
          '</div>';
      });
    }
    
    var textarea = this.modal.querySelector('.mgnl-ask-ai-modal__input');
    setTimeout(function() {
      textarea.focus();
    }, 50);
    
    document.body.style.overflow = 'hidden';
    
    if (this.options.onOpen) {
      this.options.onOpen();
    }
  };

  MagnoliaAskAIUI.prototype.close = function() {
    this.modal.classList.remove('is-open');
    this.isOpen = false;
    
    document.body.style.overflow = '';
    
    // Clear content and input
    var textarea = this.modal.querySelector('.mgnl-ask-ai-modal__input');
    this.modal.querySelector('.mgnl-ask-ai-content').innerHTML = '';
    textarea.value = '';
    textarea.style.height = 'auto';
    
    if (this.options.onClose) {
      this.options.onClose();
    }
  };

  MagnoliaAskAIUI.prototype._escapeHtml = function(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MagnoliaAskAIUI;
  } else {
    global.MagnoliaAskAIUI = MagnoliaAskAIUI;
  }

})(typeof window !== 'undefined' ? window : this);
