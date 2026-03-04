/* eslint-disable */
/**
 * Magnolia Docs AI Assistant
 * 
 * Provides AI-powered answers using:
 * - Search index for retrieval (keyword matching, scoring)
 * - Per-page .txt files for full-fidelity LLM context
 * - Streaming responses
 * 
 * ES5 compatible for UglifyJS
 */

(function(global) {
  'use strict';

  function MagnoliaAI(options) {
    options = options || {};
    this.indexUrl = options.indexUrl || '/search-data/search-index.min.json';
    this.pagesBaseUrl = options.pagesBaseUrl || '/';
    this.apiEndpoint = options.apiEndpoint || '/api/ask';
    this.apiKey = options.apiKey || null;
    this.provider = options.provider || 'anthropic';
    this.useBackendRetrieval = options.useBackendRetrieval === true;
    
    this.searchIndex = [];
    this.loaded = false;
    
    // Configuration
    this.config = {
      maxPages: 5,                // Max pages to fetch for context
      maxContextTokens: 8000,     // Approx max tokens for context
      maxContextChars: 32000,     // Hard char limit (~8000 tokens)
      minRelevanceScore: 0.3      // Minimum relevance to include
    };
  }

  /**
   * Load search index (no-op when useBackendRetrieval: API does retrieval)
   */
  MagnoliaAI.prototype.load = function() {
    var self = this;
    
    if (this.loaded) {
      return Promise.resolve();
    }
    
    if (this.useBackendRetrieval) {
      this.loaded = true;
      return Promise.resolve();
    }
    
    return fetch(this.indexUrl)
      .then(function(response) {
        if (!response.ok) throw new Error('Failed to load search index');
        return response.json();
      })
      .then(function(data) {
        self.searchIndex = data;
        self.loaded = true;
        console.log('MagnoliaAI: Loaded search index (' + self.searchIndex.length + ' records)');
      })
      .catch(function(err) {
        console.error('MagnoliaAI: Failed to load search index', err);
        throw err;
      });
  };

  /**
   * Search the index for relevant pages
   */
  MagnoliaAI.prototype.findRelevantPages = function(question, options) {
    options = options || {};
    var self = this;
    
    if (!this.loaded) {
      throw new Error('MagnoliaAI: Search index not loaded');
    }
    
    var maxPages = options.maxPages || this.config.maxPages;
    var filter = options.filter || {};
    
    var queryKeywords = this._extractKeywords(question.toLowerCase());
    
    // Score each record in the index
    var scored = [];
    for (var i = 0; i < this.searchIndex.length; i++) {
      var record = this.searchIndex[i];
      
      // Apply version/category filters
      if (filter.version && record.version !== filter.version) {
        continue;
      }
      if (filter.category && record.category !== filter.category) {
        continue;
      }
      
      var score = this._scoreRecord(queryKeywords, record, question);
      if (score >= this.config.minRelevanceScore) {
        scored.push({ record: record, score: score });
      }
    }
    
    // Sort by score descending
    scored.sort(function(a, b) {
      return b.score - a.score;
    });
    
    // Deduplicate by pagePath — keep highest-scoring record per page
    var seen = {};
    var uniquePages = [];
    
    for (var j = 0; j < scored.length; j++) {
      var item = scored[j];
      var pagePath = item.record.pagePath;
      
      if (!seen[pagePath]) {
        seen[pagePath] = true;
        uniquePages.push({
          pagePath: pagePath,
          url: item.record.url,
          title: item.record.title,
          category: item.record.category,
          version: item.record.version,
          score: item.score,
          // Track which section matched for potential targeted extraction
          matchedHeading: item.record.heading,
          matchedAnchor: item.record.url.split('#')[1] || null
        });
      }
      
      if (uniquePages.length >= maxPages) {
        break;
      }
    }
    
    return uniquePages;
  };

  /**
   * Score a search record against the query
   */
  MagnoliaAI.prototype._scoreRecord = function(queryKeywords, record, question) {
    var questionLower = question.toLowerCase();
    var titleLower = (record.title || '').toLowerCase();
    var headingLower = (record.heading || '').toLowerCase();
    var contentLower = (record.content || '').toLowerCase();
    
    var score = 0;
    
    // Exact title match bonus
    if (titleLower.indexOf(questionLower) !== -1) {
      score += 50;
    }
    
    // Exact heading match bonus
    if (headingLower && headingLower.indexOf(questionLower) !== -1) {
      score += 30;
    }
    
    // Keyword matching
    var recordText = titleLower + ' ' + headingLower + ' ' + contentLower;
    var recordKeywords = this._extractKeywords(recordText);
    
    var recordSet = {};
    recordKeywords.forEach(function(kw) {
      recordSet[kw] = true;
    });
    
    var matchCount = 0;
    
    queryKeywords.forEach(function(keyword) {
      // Exact keyword match
      if (recordSet[keyword]) {
        matchCount++;
        // Bonus for title/heading keyword match
        if (titleLower.indexOf(keyword) !== -1) {
          score += 5;
        }
        if (headingLower.indexOf(keyword) !== -1) {
          score += 3;
        }
      }
      // Partial/prefix match
      recordKeywords.forEach(function(rk) {
        if (rk.indexOf(keyword) === 0 || keyword.indexOf(rk) === 0) {
          matchCount += 0.5;
        }
      });
    });
    
    // Jaccard-like similarity
    var unionSet = {};
    queryKeywords.forEach(function(kw) { unionSet[kw] = true; });
    recordKeywords.forEach(function(kw) { unionSet[kw] = true; });
    var union = Object.keys(unionSet).length;
    if (union > 0) {
      score += (matchCount / union) * 100;
    }
    
    // Boost for h1/h2 level headings (more likely to be primary topic)
    if (record.headingLevel && record.headingLevel <= 2) {
      score *= 1.1;
    }
    
    return score;
  };

  /**
   * Extract keywords from text
   */
  MagnoliaAI.prototype._extractKeywords = function(text) {
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
      .map(function(word) { return [word, freq[word]]; })
      .sort(function(a, b) { return b[1] - a[1]; })
      .slice(0, 50)
      .map(function(item) { return item[0]; });
  };

  /**
   * Fetch the .txt file for a page
   */
  MagnoliaAI.prototype._fetchPage = function(pagePath) {
    var url = this.pagesBaseUrl + pagePath;
    
    return fetch(url)
      .then(function(response) {
        if (!response.ok) {
          console.warn('MagnoliaAI: Failed to fetch ' + pagePath);
          return null;
        }
        return response.text();
      })
      .catch(function(err) {
        console.warn('MagnoliaAI: Error fetching ' + pagePath, err);
        return null;
      });
  };

  /**
   * Fetch multiple pages and build context
   */
  MagnoliaAI.prototype._fetchAndBuildContext = function(pages) {
    var self = this;
    
    // Fetch all pages in parallel
    var fetches = pages.map(function(page) {
      return self._fetchPage(page.pagePath).then(function(content) {
        return { page: page, content: content };
      });
    });
    
    return Promise.all(fetches).then(function(results) {
      var context = '';
      var totalChars = 0;
      var sources = [];
      
      for (var i = 0; i < results.length; i++) {
        var result = results[i];
        if (!result.content) continue;
        
        var pageContent = result.content;
        
        // Check if adding this page would exceed the char limit
        if (totalChars + pageContent.length > self.config.maxContextChars) {
          // Include a trimmed version if we have room
          var remaining = self.config.maxContextChars - totalChars;
          if (remaining > 500) {
            // Try to trim intelligently: find the matched section if possible
            var trimmed = self._trimToRelevantSection(pageContent, result.page.matchedHeading, remaining);
            context += '\n\n---\n\n' + trimmed;
            totalChars += trimmed.length;
            sources.push({ title: result.page.title, url: result.page.url });
          }
          break;
        }
        
        context += '\n\n---\n\n' + pageContent;
        totalChars += pageContent.length;
        sources.push({ title: result.page.title, url: result.page.url });
      }
      
      return {
        context: context.trim(),
        sources: sources,
        charCount: totalChars
      };
    });
  };

  /**
   * Trim a page to the most relevant section when it doesn't fully fit
   */
  MagnoliaAI.prototype._trimToRelevantSection = function(content, matchedHeading, maxChars) {
    if (!matchedHeading) {
      // No specific section matched — take from the top
      return content.slice(0, maxChars);
    }
    
    // Find the matched heading in the content
    var headingIndex = content.indexOf(matchedHeading);
    if (headingIndex === -1) {
      return content.slice(0, maxChars);
    }
    
    // Center the window around the matched heading
    var halfWindow = Math.floor(maxChars / 2);
    var start = Math.max(0, headingIndex - halfWindow);
    var end = Math.min(content.length, start + maxChars);
    
    // Adjust start to not cut mid-line
    if (start > 0) {
      var newlineIndex = content.indexOf('\n', start);
      if (newlineIndex !== -1 && newlineIndex < start + 200) {
        start = newlineIndex + 1;
      }
    }
    
    var trimmed = content.slice(start, end);
    
    // Add indicators if we trimmed
    if (start > 0) {
      trimmed = '[...]\n' + trimmed;
    }
    if (end < content.length) {
      trimmed = trimmed + '\n[...]';
    }
    
    return trimmed;
  };

  /**
   * Ask via backend (Edge Function / API). When options.stream is true, streams NDJSON and calls onStreamChunk(partial) then resolves with { answer, sources }.
   */
  MagnoliaAI.prototype._askViaBackend = function(question, options) {
    var self = this;
    var filter = options.filter || {};
    var stream = options.stream === true;
    var onStreamChunk = options.onStreamChunk || function() {};
    var body = { question: question, filter: filter };
    if (stream) body.stream = true;
    return fetch(this.apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(response) {
      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }
      var contentType = (response.headers.get('Content-Type') || '').toLowerCase();
      var isNdjson = contentType.indexOf('ndjson') !== -1 || contentType.indexOf('x-ndjson') !== -1;
      if (stream && response.body && isNdjson) {
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var answer = '';
        var sources = [];
        var processLine = function(line) {
          line = line.trim();
          if (!line) return;
          try {
            var obj = JSON.parse(line);
            if (obj.type === 'content' && typeof obj.delta === 'string') {
              answer += obj.delta;
              onStreamChunk(answer);
            } else if (obj.type === 'done' && Array.isArray(obj.sources)) {
              sources = obj.sources;
            }
          } catch (err) { /* skip */ }
        };
        var readNext = function() {
          return reader.read().then(function(result) {
            if (result.done) {
              if (buffer.trim()) processLine(buffer);
              return { answer: answer, sources: sources, context: null };
            }
            buffer += decoder.decode(result.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (var j = 0; j < lines.length; j++) {
              processLine(lines[j]);
            }
            return readNext();
          });
        };
        return readNext();
      }
      return response.json().then(function(data) {
        return {
          answer: data.answer || null,
          sources: data.sources || [],
          context: null
        };
      });
    });
  };

  /**
   * Ask a question
   */
  MagnoliaAI.prototype.ask = function(question, options) {
    options = options || {};
    var self = this;
    
    if (this.useBackendRetrieval && this.apiEndpoint) {
      return this.load().then(function() {
        return self._askViaBackend(question, options);
      });
    }
    
    if (!this.loaded) {
      return this.load().then(function() {
        return self.ask(question, options);
      });
    }
    
    // Step 1: Find relevant pages via search index
    var relevantPages = this.findRelevantPages(question, {
      maxPages: options.maxPages || this.config.maxPages,
      filter: options.filter || {}
    });
    
    if (relevantPages.length === 0) {
      return Promise.resolve({
        answer: "I couldn't find relevant documentation to answer your question. Try rephrasing or being more specific.",
        sources: [],
        context: null
      });
    }
    
    // Step 2: Fetch .txt files and build context
    return this._fetchAndBuildContext(relevantPages).then(function(contextData) {
      var context = contextData.context;
      var sources = contextData.sources;
      
      if (!context) {
        return {
          answer: "I found some relevant pages but couldn't load their content. Please try again.",
          sources: [],
          context: null
        };
      }
      
      // Step 3: Build prompts
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

      // Step 4: Call the API
      if (self.apiEndpoint && !self.apiKey) {
        return fetch(self.apiEndpoint, {
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
      
      // Direct API call (for testing only)
      if (self.apiKey) {
        return self._callLLMDirect(systemPrompt, userPrompt).then(function(answer) {
          return {
            answer: answer,
            sources: sources,
            context: context
          };
        });
      }
      
      // No API configured
      return {
        answer: null,
        sources: sources,
        context: context,
        prompt: userPrompt,
        systemPrompt: systemPrompt
      };
    });
  };

  /**
   * Direct LLM call (for development/testing only)
   */
  MagnoliaAI.prototype._callLLMDirect = function(systemPrompt, userPrompt) {
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
      .then(function(response) { return response.json(); })
      .then(function(data) { return data.content[0].text; });
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
      .then(function(response) { return response.json(); })
      .then(function(data) { return data.choices[0].message.content; });
    }
    
    return Promise.reject(new Error('Unknown provider: ' + this.provider));
  };

  /**
   * Stream a response (if using backend with streaming support)
   * Note: Generators not supported in ES5, so this is a placeholder
   */
  MagnoliaAI.prototype.askStream = function(question, options) {
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
 *     indexUrl: '/search-data/search-index.min.json',
 *     pagesBaseUrl: '/',
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
      indexUrl: options.indexUrl || '/search-data/search-index.min.json',
      pagesBaseUrl: options.pagesBaseUrl || '/',
      apiEndpoint: options.apiEndpoint || '/api/ask',
      useBackendRetrieval: options.useBackendRetrieval === true,
      placeholder: options.placeholder || 'Ask a question about Magnolia...',
      hotkey: options.hotkey || '?',
      enabled: options.enabled !== undefined ? options.enabled : false,
      position: options.position || 'header',
      showFilters: options.showFilters !== false,
      showFooter: options.showFooter !== false,
      branding: options.branding || 'Powered by Magnolia AI',
      maxQuestionsPerSession: options.maxQuestionsPerSession || 12,
      maxPages: options.maxPages || 5,
      maxContextTokens: options.maxContextTokens || 8000,
      filters: options.filters || DEFAULT_FILTERS,
      onAnswer: options.onAnswer || null,
      onOpen: options.onOpen || null,
      onClose: options.onClose || null,
      styleTestMode: options.styleTestMode === true
    };
    
    this.ai = null;
    this.modal = null;
    this.currentFilter = '';
    this.isOpen = false;
    this.questionsAsked = 0;
    this.isLoading = false;
    this.loadingMessageIndex = 0;
    this.loadingMessageInterval = null;
    
    // Initialize only if enabled
    if (this.options.enabled) {
      this._init();
    }
  }

  MagnoliaAskAIUI.prototype._init = function() {
    var self = this;
    
    // Check if MagnoliaAI is available
    if (typeof MagnoliaAI === 'undefined') {
      console.error('MagnoliaAskAIUI: MagnoliaAI not found. Include magnolia-ask-ai.js first.');
      return;
    }
    
    // Initialize AI assistant with new options
    this.ai = new MagnoliaAI({
      indexUrl: this.options.indexUrl,
      pagesBaseUrl: this.options.pagesBaseUrl,
      apiEndpoint: this.options.apiEndpoint,
      useBackendRetrieval: this.options.useBackendRetrieval === true
    });
    
    // Load questions asked count from sessionStorage
    this._loadSessionState();
    
    // Create UI elements
    this._createTrigger();
    this._createModal();
    this._bindEvents();
    
    // NOTE: Search index is loaded lazily when user opens Ask AI modal
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

  MagnoliaAskAIUI.prototype._createTrigger = function() {
    var container = document.querySelector(this.options.container);
    if (!container) {
      console.warn('MagnoliaAskAIUI: Container not found:', this.options.container);
      return;
    }
    
    var self = this;
    var positionClass = 'mgnl-ask-ai-trigger--' + this.options.position;
    
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
            '<button type="button" class="mgnl-ask-ai-modal__clear" aria-label="Clear question" style="display: none;">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<path d="M18 6L6 18M6 6l12 12"/>' +
              '</svg>' +
            '</button>' +
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
    
    if (this.options.showFilters) {
      this._renderFilters();
    }
    
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
    var clearButton = this.modal.querySelector('.mgnl-ask-ai-modal__clear');
    
    clearButton.addEventListener('click', function() {
      textarea.value = '';
      textarea.style.height = 'auto';
      textarea.focus();
      self._updateClearButtonVisibility('');
    });
    
    textarea.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = (this.scrollHeight) + 'px';
      self._updateClearButtonVisibility(this.value);
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
      var isHotkey = false;
      
      if (self.options.hotkey === '?') {
        var isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        if (isMac) {
          isHotkey = (e.key === '/' && (e.metaKey || e.ctrlKey));
        } else {
          isHotkey = ((e.key === '/' && e.ctrlKey) || (e.key === '/' && e.shiftKey));
        }
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
    
    // When using backend retrieval, no index load is required
    if (!this.ai) {
      this._showError('AI assistant is not available.');
      return;
    }
    if (!this.options.useBackendRetrieval && !this.ai.loaded) {
      this._showError('AI assistant is still loading. Please wait a moment.');
      return;
    }
    
    if (this.isLoading) return;
    
    this.isLoading = true;
    this.questionsAsked++;
    this._saveSessionState();
    this._updateRateLimitDisplay();
    
    // Show loading state
    this._showLoading(question);
    
    var self = this;
    var filter = this.currentFilter ? { version: this.currentFilter } : {};
    
    // Style test mode: use dummy data so styling can be tested without the edge function
    if (this.options.styleTestMode) {
      var dummy = this._getDummyAskAiResponse();
      var delay = 600;
      setTimeout(function() {
        self.isLoading = false;
        if (self.loadingMessageInterval) {
          clearInterval(self.loadingMessageInterval);
          self.loadingMessageInterval = null;
        }
        self._showAnswer(dummy.answer, dummy.sources);
        if (self.options.onAnswer) {
          self.options.onAnswer({ answer: dummy.answer, sources: dummy.sources });
        }
      }, delay);
      return;
    }
    
    // Ask question (stream when backend supports it for incremental display)
    var askOpts = { maxPages: this.options.maxPages, filter: filter };
    if (!this.options.styleTestMode && this.ai.useBackendRetrieval) {
      askOpts.stream = true;
      var lastPartial = '';
      askOpts.onStreamChunk = (function(q) {
        return function(partial) {
          lastPartial = partial;
          if (self._streamDebounceTimer) return;
          self._streamDebounceTimer = setTimeout(function() {
            self._streamDebounceTimer = null;
            self._updateStreamingAnswer(q, lastPartial);
          }, 80);
        };
      })(question);
    }
    this.ai.ask(question, askOpts).then(function(response) {
      self.isLoading = false;
      if (self._streamDebounceTimer) {
        clearTimeout(self._streamDebounceTimer);
        self._streamDebounceTimer = null;
      }
      if (self.loadingMessageInterval) {
        clearInterval(self.loadingMessageInterval);
        self.loadingMessageInterval = null;
      }
      
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
      if (self._streamDebounceTimer) {
        clearTimeout(self._streamDebounceTimer);
        self._streamDebounceTimer = null;
      }
      if (self.loadingMessageInterval) {
        clearInterval(self.loadingMessageInterval);
        self.loadingMessageInterval = null;
      }
      console.error('MagnoliaAskAIUI: Error asking question:', err);
      self._showError('An error occurred. Please try again.');
    });
  };

  MagnoliaAskAIUI.prototype._showLoading = function(question) {
    var self = this;
    var contentContainer = this.modal.querySelector('.mgnl-ask-ai-content');
    
    var loadingMessages = [
      'Searching documentation...',
      'Loading relevant pages...',
      'Analyzing your question...',
      'Crafting your answer...',
      'Almost there...'
    ];
    
    this.loadingMessageIndex = 0;
    
    if (this.loadingMessageInterval) {
      clearInterval(this.loadingMessageInterval);
    }
    
    contentContainer.innerHTML = 
      '<div class="mgnl-ask-ai-question">' +
        '<div class="mgnl-ask-ai-question__label">Question:</div>' +
        '<div class="mgnl-ask-ai-question__text">' + this._escapeHtml(question) + '</div>' +
      '</div>' +
      '<div class="mgnl-ask-ai-loading">' +
        '<div class="mgnl-ask-ai-loading__dots">' +
          '<span class="mgnl-ask-ai-loading__dot"></span>' +
          '<span class="mgnl-ask-ai-loading__dot"></span>' +
          '<span class="mgnl-ask-ai-loading__dot"></span>' +
        '</div>' +
        '<div class="mgnl-ask-ai-loading__text">' + this._escapeHtml(loadingMessages[0]) + '</div>' +
      '</div>';
    
    var messageElement = contentContainer.querySelector('.mgnl-ask-ai-loading__text');
    this.loadingMessageInterval = setInterval(function() {
      self.loadingMessageIndex = (self.loadingMessageIndex + 1) % loadingMessages.length;
      if (messageElement) {
        messageElement.style.opacity = '0';
        setTimeout(function() {
          messageElement.textContent = loadingMessages[self.loadingMessageIndex];
          messageElement.style.opacity = '1';
        }, 200);
      }
    }, 2500);
  };

  /**
   * Update the content area with a streaming partial answer (question + formatted partial, no sources yet).
   */
  MagnoliaAskAIUI.prototype._updateStreamingAnswer = function(question, partialAnswer) {
    if (this.loadingMessageInterval) {
      clearInterval(this.loadingMessageInterval);
      this.loadingMessageInterval = null;
    }
    var contentContainer = this.modal.querySelector('.mgnl-ask-ai-content');
    var formattedAnswer = this._formatAnswer(partialAnswer || '', []);
    contentContainer.innerHTML =
      '<div class="mgnl-ask-ai-question">' +
        '<div class="mgnl-ask-ai-question__label">Question:</div>' +
        '<div class="mgnl-ask-ai-question__text">' + this._escapeHtml(question) + '</div>' +
      '</div>' +
      '<div class="mgnl-ask-ai-answer">' +
        '<div class="mgnl-ask-ai-answer__text">' + formattedAnswer + '</div>' +
      '</div>';
    var self = this;
    contentContainer.querySelectorAll('.mgnl-ask-ai-code-copy').forEach(function(button) {
      button.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var codeId = button.getAttribute('data-copy-target');
        var codeEl = document.getElementById(codeId);
        if (codeEl) {
          var text = codeEl.textContent || codeEl.innerText;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
              var orig = button.innerHTML;
              button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
              button.classList.add('copied');
              setTimeout(function() { button.innerHTML = orig; button.classList.remove('copied'); }, 2000);
            });
          } else {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try {
              document.execCommand('copy');
              var orig = button.innerHTML;
              button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
              button.classList.add('copied');
              setTimeout(function() { button.innerHTML = orig; button.classList.remove('copied'); }, 2000);
            } catch (err) {}
            document.body.removeChild(ta);
          }
        }
      });
    });
  };

  MagnoliaAskAIUI.prototype._showAnswer = function(answer, sources) {
    var contentContainer = this.modal.querySelector('.mgnl-ask-ai-content');
    var self = this;
    
    // Format answer with footnote processing (pass sources for matching)
    var formattedAnswer = this._formatAnswer(answer, sources || []);
    
    var sourcesHtml = '';
    if (sources && sources.length > 0) {
      sourcesHtml = 
        '<div class="mgnl-ask-ai-sources" id="mgnl-ask-ai-sources">' +
          '<div class="mgnl-ask-ai-sources__label">Sources:</div>' +
          '<div class="mgnl-ask-ai-sources__list">' +
            sources.map(function(source, index) {
              var footnoteId = 'mgnl-source-' + index;
              return '<a href="' + self._escapeHtml(source.url) + '" target="_blank" class="mgnl-ask-ai-source" id="' + footnoteId + '">' +
                '<span class="mgnl-ask-ai-source__number">[' + (index + 1) + ']</span> ' +
                '<span class="mgnl-ask-ai-source__title">' + self._escapeHtml(source.title) + '</span>' +
              '</a>';
            }).join('') +
          '</div>' +
        '</div>';
    }
    
    contentContainer.innerHTML = 
      '<div class="mgnl-ask-ai-answer">' +
        '<div class="mgnl-ask-ai-answer__text">' + formattedAnswer + '</div>' +
      '</div>' +
      sourcesHtml;
    
    // Add smooth scroll behavior for footnote clicks
    var footnoteLinks = contentContainer.querySelectorAll('.mgnl-ask-ai-footnote');
    footnoteLinks.forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        var targetId = link.getAttribute('href').substring(1); // Remove #
        var targetElement = document.getElementById(targetId);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          // Highlight the target briefly
          targetElement.style.transition = 'background-color 0.3s ease';
          var originalBg = targetElement.style.backgroundColor;
          targetElement.style.backgroundColor = 'var(--rebrand-color-primary-sand)';
          setTimeout(function() {
            targetElement.style.backgroundColor = originalBg || '';
          }, 1500);
        }
      });
    });
    
    // Add copy-to-clipboard functionality for code blocks
    var copyButtons = contentContainer.querySelectorAll('.mgnl-ask-ai-code-copy');
    copyButtons.forEach(function(button) {
      button.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var codeId = button.getAttribute('data-copy-target');
        var codeElement = document.getElementById(codeId);
        if (codeElement) {
          var text = codeElement.textContent || codeElement.innerText;
          
          // Use modern Clipboard API if available
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
              // Show success feedback
              var originalHTML = button.innerHTML;
              button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
              button.classList.add('copied');
              setTimeout(function() {
                button.innerHTML = originalHTML;
                button.classList.remove('copied');
              }, 2000);
            }).catch(function(err) {
              console.error('Failed to copy:', err);
            });
          } else {
            // Fallback for older browsers
            var textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            try {
              document.execCommand('copy');
              var originalHTML = button.innerHTML;
              button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
              button.classList.add('copied');
              setTimeout(function() {
                button.innerHTML = originalHTML;
                button.classList.remove('copied');
              }, 2000);
            } catch (err) {
              console.error('Fallback copy failed:', err);
            }
            document.body.removeChild(textArea);
          }
        }
      });
    });
  };

  MagnoliaAskAIUI.prototype._showError = function(message) {
    var contentContainer = this.modal.querySelector('.mgnl-ask-ai-content');
    contentContainer.innerHTML = 
      '<div class="mgnl-ask-ai-error">' +
        '<div class="mgnl-ask-ai-error__icon">⚠</div>' +
        '<div class="mgnl-ask-ai-error__text">' + this._escapeHtml(message) + '</div>' +
      '</div>';
  };

  /**
   * Dummy response for style-test mode (no API call). Exercises headings, nested lists,
   * code blocks (XML, JSON, YAML) with angle brackets/special chars, inline code, and sources.
   */
  MagnoliaAskAIUI.prototype._getDummyAskAiResponse = function() {
    var answer = 'To enable multiple languages for your content in Magnolia DXP, follow these steps:\n\n' +
      '1. Enable Multilanguage Content:\n' +
      '- Configure the **I18NAuthoringSupport** implementation to support multilanguage editing.\n' +
      '- Set `i18n: true` in the form fields where you want to allow multilanguage content entry.\n' +
      '- Set `i18n: true` in the properties of the content types where multilanguage support is needed.\n' +
      '- Define the available locales in your site configuration.\n\n' +
      'Configuration Examples:\n' +
      '- To enable multilanguage authoring, add the following in your module descriptor:\n\n' +
      '```xml\n' +
      '<component>\n' +
      '  <type>info.magnolia.ui.api.i18n.I18NAuthoringSupport</type>\n' +
      '</component>\n' +
      '```\n\n' +
      '- Or in your app config (JSON):\n\n' +
      '```json\n' +
      '{\n' +
      '  "i18n": true,\n' +
      '  "locales": ["en", "de", "fr"],\n' +
      '  "defaultLocale": "en"\n' +
      '}\n' +
      '```\n\n' +
      '- Or in YAML:\n\n' +
      '```yaml\n' +
      'i18n: true\n' +
      'locales:\n' +
      '  - en\n' +
      '  - de\n' +
      '  - fr\n' +
      'defaultLocale: en\n' +
      '```\n\n' +
      'Then register the locales in your site definition. Use **Configuration** app for runtime changes.';
    var sources = [
      { title: 'Language configuration', url: '/product-docs/6.3/Administration/Language-configuration/' },
      { title: 'Set up multilanguage content', url: '/product-docs/6.3/Content-authoring/Set-up-multilanguage-content/' },
      { title: 'Localizing content', url: '/product-docs/6.3/Content-authoring/Localizing-content/' },
      { title: 'Configuration app', url: '/product-docs/6.3/Administration/Configuration-app/' }
    ];
    return { answer: answer, sources: sources };
  };

  /**
   * Build one code block HTML (wrapper + copy button + lang label). Used by marked renderer and fallback.
   */
  MagnoliaAskAIUI.prototype._renderMarkedCodeBlock = function(rawCode, lang, index) {
    var self = this;
    var formattedCode = self._decodeHtmlEntities(rawCode).trim();
    var langLower = lang ? lang.toLowerCase().replace(/^language-/, '') : '';
    if (langLower === 'json') {
      try {
        var parsed = JSON.parse(formattedCode);
        formattedCode = JSON.stringify(parsed, null, 2);
      } catch (e) { /* keep original */ }
    } else if (langLower === 'yaml' || langLower === 'yml') {
      var lines = formattedCode.split('\n');
      var minIndent = Infinity;
      lines.forEach(function(line) {
        if (line.trim().length) {
          var n = (line.match(/^(\s*)/) || ['', ''])[1].length;
          if (n < minIndent) minIndent = n;
        }
      });
      if (minIndent > 0 && minIndent < Infinity) {
        formattedCode = lines.map(function(line) {
          return line.trim().length ? line.substring(minIndent) : '';
        }).join('\n');
      }
    } else if (langLower === 'xml' || langLower === 'html') {
      try {
        var indentLevel = 0;
        formattedCode = formattedCode.replace(/>\s*</g, '>\n<');
        formattedCode = formattedCode.split('\n').map(function(line) {
          var trimmed = line.trim();
          if (!trimmed) return '';
          if (trimmed.match(/^<\/\w/)) indentLevel = Math.max(0, indentLevel - 1);
          var indented = ' '.repeat(indentLevel * 2) + trimmed;
          if (trimmed.match(/^<\w[^>]*[^/]>$/) && !trimmed.match(/\/>$/)) indentLevel++;
          return indented;
        }).join('\n');
      } catch (e) { /* keep original */ }
    }
    var codeId = 'mgnl-code-' + index;
    var langClass = lang ? ' class="language-' + this._escapeHtml(lang) + '"' : '';
    var langLabel = lang ? '<span class="mgnl-ask-ai-code-lang">' + this._escapeHtml(lang) + '</span>' : '';
    return '<div class="mgnl-ask-ai-code-block" data-code-id="' + codeId + '">' +
      langLabel +
      '<button type="button" class="mgnl-ask-ai-code-copy" aria-label="Copy code" data-copy-target="' + codeId + '" title="Copy to clipboard">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>' +
      '<pre><code id="' + codeId + '"' + langClass + '>' + this._escapeHtmlForCode(formattedCode) + '</code></pre></div>';
  };

  MagnoliaAskAIUI.prototype._formatAnswer = function(answer, sources) {
    if (!answer) return '';
    
    var self = this;
    sources = sources || [];
    
    // Step 0: Strip the Sources section from the LLM response so we only show the styled sources at the bottom
    var formatted = answer.replace(/\n\s*#{1,6}\s*Sources?\s*:?\s*\n[\s\S]*$/i, '');
    formatted = formatted.replace(/\n\s*Sources?\s*:?\s*\n[\s\S]*$/i, '');
    
    // Remove "Source:" lines - sources are shown separately
    formatted = formatted.replace(/Source:\s*\*?[^\n]*\n?/gi, '');
    formatted = formatted.replace(/https?:\/\/[^\s]+/g, '');
    
    // Step 0b: Process citations - replace "(Page: ...)" with footnote numbers
    var footnoteCounter = 0;
    var footnoteMap = {}; // Maps footnote number to source index
    
    // Step 0.5: Decode HTML entities FIRST (citations might be HTML-encoded)
    formatted = self._decodeHtmlEntities(formatted);
    
    // Step 0.6: Handle HTML-encoded code tags that might still exist after decoding
    // Some LLMs return &lt;code&gt; which gets decoded to <code>, but we need to process them
    formatted = formatted.replace(/&lt;code&gt;([^&]+?)&lt;\/code&gt;/gi, function(match, code) {
      return '<code>' + self._escapeHtmlForCode(code.trim()) + '</code>';
    });
    
    // Process "(Page: ...)" citations AFTER HTML decoding
    // Match patterns like: (Page: "title"), (Page: title), (Page: ), (Page:), (Page: "title":), (Page: "title").
    // Also handle: Page: "title" (without parentheses) as fallback
    // Handle variations with trailing colons, quotes, periods, etc.
    // More flexible regex that handles various formats including trailing punctuation
    
    // First, handle citations WITH parentheses (most common)
    formatted = formatted.replace(/\(Page:\s*([^)]*?)(?::\s*)?\)\.?/gi, function(match, pageText) {
      footnoteCounter++;
      var footnoteNum = footnoteCounter;
      
      // Try to match the page text to a source
      var matchedSourceIndex = -1;
      if (pageText && pageText.trim()) {
        // Remove quotes if present and trim
        var cleanPageText = pageText.replace(/^["']|["']$/g, '').trim().toLowerCase();
        
        // Try to find matching source by title
        for (var i = 0; i < sources.length; i++) {
          var sourceTitle = (sources[i].title || '').toLowerCase();
          // More flexible matching - check if either contains the other
          if (sourceTitle.indexOf(cleanPageText) !== -1 || cleanPageText.indexOf(sourceTitle) !== -1) {
            matchedSourceIndex = i;
            break;
          }
        }
      }
      
      // If no match found, assign sequentially (will map to source index if available)
      if (matchedSourceIndex === -1 && sources.length > 0) {
        // Use modulo to cycle through sources if we have more citations than sources
        matchedSourceIndex = (footnoteCounter - 1) % sources.length;
      }
      
      footnoteMap[footnoteNum] = matchedSourceIndex;
      
      // Create footnote link
      var footnoteId = matchedSourceIndex >= 0 ? 'mgnl-source-' + matchedSourceIndex : '';
      var footnoteLink = '<a href="#' + (footnoteId || 'mgnl-ask-ai-sources') + '" class="mgnl-ask-ai-footnote" data-footnote="' + footnoteNum + '">[' + footnoteNum + ']</a>';
      
      return footnoteLink;
    });
    
    // Also handle citations WITHOUT parentheses (fallback for edge cases)
    // Pattern: Page: "title" or Page: title (at end of sentence or before punctuation)
    formatted = formatted.replace(/\bPage:\s*([^.,;:!?)\]]+?)(?::\s*)?(?=[.,;:!?)\]]|$)/gi, function(match, pageText) {
      footnoteCounter++;
      var footnoteNum = footnoteCounter;
      
      // Try to match the page text to a source
      var matchedSourceIndex = -1;
      if (pageText && pageText.trim()) {
        // Remove quotes if present and trim
        var cleanPageText = pageText.replace(/^["']|["']$/g, '').trim().toLowerCase();
        
        // Try to find matching source by title
        for (var i = 0; i < sources.length; i++) {
          var sourceTitle = (sources[i].title || '').toLowerCase();
          // More flexible matching - check if either contains the other
          if (sourceTitle.indexOf(cleanPageText) !== -1 || cleanPageText.indexOf(sourceTitle) !== -1) {
            matchedSourceIndex = i;
            break;
          }
        }
      }
      
      // If no match found, assign sequentially
      if (matchedSourceIndex === -1 && sources.length > 0) {
        matchedSourceIndex = (footnoteCounter - 1) % sources.length;
      }
      
      footnoteMap[footnoteNum] = matchedSourceIndex;
      
      // Create footnote link
      var footnoteId = matchedSourceIndex >= 0 ? 'mgnl-source-' + matchedSourceIndex : '';
      var footnoteLink = '<a href="#' + (footnoteId || 'mgnl-ask-ai-sources') + '" class="mgnl-ask-ai-footnote" data-footnote="' + footnoteNum + '">[' + footnoteNum + ']</a>';
      
      return footnoteLink;
    });
    
    // Use marked.js when available; avoid custom renderers to prevent marked v12 token API mismatch (t.text is not a function)
    if (typeof marked !== 'undefined') {
      try {
        var markedHtml = marked.parse(formatted);
        var codeBlockIdx = 0;
        // Post-process: wrap marked's <pre><code class="language-x"> in our code-block div + copy button
        markedHtml = markedHtml.replace(/<pre><code(?:\s+class="[^"]*language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/gi, function(_, lang, code) {
          var langStr = (lang != null && lang !== undefined) ? String(lang).trim() : '';
          var codeStr = (code != null && code !== undefined) ? String(code) : '';
          var block = self._renderMarkedCodeBlock(self._decodeHtmlEntities(codeStr), langStr, codeBlockIdx);
          codeBlockIdx++;
          return block;
        });
        return markedHtml;
      } catch (e) {
        console.warn('MagnoliaAskAIUI: marked.parse failed, using fallback', e);
      }
    }
    
    // Step 1: Convert code blocks (```code```) first (fallback when marked not available)
    var codeBlocks = [];
    var codeBlockIndex = 0;
    formatted = formatted.replace(/```(\w*)\n?([\s\S]*?)```/g, function(match, lang, code) {
      var placeholder = '___CODE_BLOCK_' + codeBlockIndex + '___';
      codeBlocks[codeBlockIndex] = self._renderMarkedCodeBlock(code, lang || '', codeBlockIndex);
      codeBlockIndex++;
      return placeholder;
    });
    
    // Step 2: Convert inline code
    // Process in order: HTML tags → markdown backticks
    
    // Handle plain HTML code tags (after HTML entity decoding converts &lt; to <)
    // This handles: <code>...</code> that might be in the response
    formatted = formatted.replace(/<code>([^<]+?)<\/code>/gi, function(match, code) {
      // Only process if content doesn't already contain HTML (to avoid double-processing)
      if (code.indexOf('<') === -1) {
        return '<code>' + self._escapeHtmlForCode(code.trim()) + '</code>';
      }
      return match;
    });
    
    // Handle markdown backticks (e.g., `code`)
    formatted = formatted.replace(/`([^`\n]+)`/g, function(match, code) {
      // Skip if already inside a code tag (simple check)
      return '<code>' + self._escapeHtmlForCode(code) + '</code>';
    });
    
    // Step 3: Restore code blocks
    codeBlocks.forEach(function(block, index) {
      formatted = formatted.replace('___CODE_BLOCK_' + index + '___', block);
    });
    
    // Step 4: Convert markdown links
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(match, text, url) {
      return '<a href="' + self._escapeHtml(url) + '" target="_blank" rel="noopener">' + self._escapeHtml(text) + '</a>';
    });
    
    // Step 5: Convert bold (skip when content is/contains <code> so code isn't wrapped in strong)
    formatted = formatted.replace(/\*\*([^*\n]+)\*\*/g, function(match, text) {
      if (/<code[\s>][\s\S]*?<\/code>/i.test(text.trim())) {
        return text;
      }
      return '<strong>' + self._escapeHtml(text) + '</strong>';
    });
    
    // Step 6: Convert italic (skip when content is/contains <code> so code isn't wrapped in em)
    formatted = formatted.replace(/\*([^*\n]+?)\*/g, function(match, text) {
      if (!text.trim()) return match;
      if (/<code[\s>][\s\S]*?<\/code>/i.test(text.trim())) {
        return text;
      }
      return '<em>' + self._escapeHtml(text) + '</em>';
    });
    
    // Step 6.5: Convert markdown headings
    formatted = formatted.replace(/^####\s+(.+)$/gm, function(match, text) {
      return '<h4>' + text + '</h4>';
    });
    formatted = formatted.replace(/^###\s+(.+)$/gm, function(match, text) {
      return '<h3>' + text + '</h3>';
    });
    formatted = formatted.replace(/^##\s+(.+)$/gm, function(match, text) {
      return '<h2>' + text + '</h2>';
    });
    formatted = formatted.replace(/^#\s+(.+)$/gm, function(match, text) {
      return '<h1>' + text + '</h1>';
    });
    
    // Step 7: Convert lists with proper nesting (bullets under numbered item = nested <ul> inside <li>)
    var lines = formatted.split('\n');
    var htmlLines = [];
    var listStack = [];
    var INDENT_STEP = 2;
    var pendingOlLiClose = false; // we output <li> for an ol but not </li> so bullets can nest
    var inNestedUl = false;
    
    function closeListsToDepth(depth) {
      while (listStack.length > depth) {
        htmlLines.push('</' + listStack.pop() + '>');
      }
    }
    
    function closePendingNested() {
      if (inNestedUl) {
        htmlLines.push('</li></ul>');
        inNestedUl = false;
      }
      if (pendingOlLiClose) {
        htmlLines.push('</li>');
        pendingOlLiClose = false;
      }
    }
    
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var leadingSpaces = (line.match(/^(\s*)/) || ['', ''])[1].length;
      var trimmed = line.trim();
      var indentLevel = Math.floor(leadingSpaces / INDENT_STEP);
      
      if (!trimmed) {
        continue;
      }
      
      var numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
      if (numMatch) {
        closePendingNested();
        closeListsToDepth(indentLevel);
        while (listStack.length < indentLevel) {
          listStack.push('ol');
          htmlLines.push('<ol>');
        }
        if (listStack.length > 0 && listStack[listStack.length - 1] !== 'ol') {
          closeListsToDepth(indentLevel);
          listStack.push('ol');
          htmlLines.push('<ol>');
        } else if (listStack.length === 0) {
          listStack.push('ol');
          htmlLines.push('<ol>');
        }
        htmlLines.push('<li>' + numMatch[2]);
        pendingOlLiClose = true;
        continue;
      }
      
      var bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
      if (bulletMatch) {
        var bulletNestedUnderOl = (leadingSpaces === 0 && listStack.length > 0 && listStack[listStack.length - 1] === 'ol' && pendingOlLiClose);
        if (bulletNestedUnderOl) {
          htmlLines.push('<ul><li>' + bulletMatch[1]);
          pendingOlLiClose = false;
          inNestedUl = true;
          continue;
        }
        if (inNestedUl && leadingSpaces === 0) {
          htmlLines.push('</li><li>' + bulletMatch[1]);
          continue;
        }
        closePendingNested();
        var effectiveBulletIndent = (leadingSpaces > 0) ? indentLevel : 0;
        closeListsToDepth(effectiveBulletIndent);
        while (listStack.length < effectiveBulletIndent) {
          listStack.push('ul');
          htmlLines.push('<ul>');
        }
        if (listStack.length > 0 && listStack[listStack.length - 1] !== 'ul') {
          closeListsToDepth(effectiveBulletIndent);
          listStack.push('ul');
          htmlLines.push('<ul>');
        } else if (listStack.length === 0) {
          listStack.push('ul');
          htmlLines.push('<ul>');
        }
        htmlLines.push('<li>' + bulletMatch[1] + '</li>');
        continue;
      }
      
      closePendingNested();
      closeListsToDepth(0);
      htmlLines.push(trimmed);
    }
    
    closePendingNested();
    closeListsToDepth(0);
    formatted = htmlLines.join('\n');
    
    // Step 8: Escape remaining HTML
    var parts = formatted.split(/(<[^>]+>)/g);
    var escapedParts = parts.map(function(part) {
      if (part.match(/^<[^>]+>$/)) {
        return part;
      }
      return self._escapeHtml(part);
    });
    formatted = escapedParts.join('');
    
    // Step 9: Convert to paragraphs
    var paragraphs = [];
    var currentPara = [];
    
    var paraLines = formatted.split('\n');
    for (var j = 0; j < paraLines.length; j++) {
      var paraLine = paraLines[j].trim();
      if (!paraLine) {
        if (currentPara.length > 0) {
          paragraphs.push(currentPara.join('\n'));
          currentPara = [];
        }
        continue;
      }
      
      if (paraLine.startsWith('<ol>') || paraLine.startsWith('<ul>') ||
          paraLine.startsWith('</ol>') || paraLine.startsWith('</ul>') ||
          paraLine.startsWith('<li>') || paraLine.startsWith('</li>') ||
          paraLine.startsWith('<pre>') ||
          paraLine.startsWith('<h1>') || paraLine.startsWith('<h2>') || 
          paraLine.startsWith('<h3>') || paraLine.startsWith('<h4>') ||
          paraLine.startsWith('</h1>') || paraLine.startsWith('</h2>') || 
          paraLine.startsWith('</h3>') || paraLine.startsWith('</h4>')) {
        if (currentPara.length > 0) {
          paragraphs.push(currentPara.join('\n'));
          currentPara = [];
        }
        paragraphs.push(paraLine);
        continue;
      }
      
      currentPara.push(paraLine);
    }
    
    if (currentPara.length > 0) {
      paragraphs.push(currentPara.join('\n'));
    }
    
    return paragraphs.map(function(para) {
      para = para.trim();
      if (para.startsWith('<ol>') || para.startsWith('<ul>') || para.startsWith('<li>') || para.startsWith('</li>') ||
          para.startsWith('</ol>') || para.startsWith('</ul>') || para.startsWith('<pre>') ||
          para.startsWith('<h1>') || para.startsWith('<h2>') || para.startsWith('<h3>') || para.startsWith('<h4>')) {
        return para;
      }
      para = para.replace(/\n/g, '<br>');
      return '<p>' + para + '</p>';
    }).join('');
  };

  MagnoliaAskAIUI.prototype.open = function() {
    if (!this.options.enabled) return;
    
    var self = this;
    
    this.modal.classList.add('is-open');
    this.isOpen = true;
    
    // Lazy load search index when modal opens
    if (!this.ai.loaded && !this.indexLoading) {
      this.indexLoading = true;
      var contentContainer = this.modal.querySelector('.mgnl-ask-ai-content');
      contentContainer.innerHTML = 
        '<div class="mgnl-ask-ai-loading">' +
          '<div class="mgnl-ask-ai-loading__spinner"></div>' +
          '<div class="mgnl-ask-ai-loading__text">Loading AI assistant...</div>' +
        '</div>';
      
      this.ai.load().then(function() {
        self.indexLoading = false;
        contentContainer.innerHTML = '';
        if (self.loadingMessageInterval) {
          clearInterval(self.loadingMessageInterval);
          self.loadingMessageInterval = null;
        }
      }).catch(function(err) {
        console.warn('MagnoliaAskAIUI: Failed to load search index:', err);
        self.indexLoading = false;
        if (self.loadingMessageInterval) {
          clearInterval(self.loadingMessageInterval);
          self.loadingMessageInterval = null;
        }
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
    
    var textarea = this.modal.querySelector('.mgnl-ask-ai-modal__input');
    this.modal.querySelector('.mgnl-ask-ai-content').innerHTML = '';
    textarea.value = '';
    textarea.style.height = 'auto';
    this._updateClearButtonVisibility('');
    
    if (this.options.onClose) {
      this.options.onClose();
    }
  };
  
  MagnoliaAskAIUI.prototype._updateClearButtonVisibility = function(value) {
    var clearButton = this.modal.querySelector('.mgnl-ask-ai-modal__clear');
    if (clearButton) {
      clearButton.style.display = value && value.length > 0 ? 'block' : 'none';
    }
  };

  MagnoliaAskAIUI.prototype._escapeHtml = function(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    var escaped = div.innerHTML;
    escaped = escaped.replace(/&gt;/g, '>');
    return escaped;
  };

  /** Escape for use inside <code> / <pre> so angle brackets display correctly (e.g. XML). */
  MagnoliaAskAIUI.prototype._escapeHtmlForCode = function(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  MagnoliaAskAIUI.prototype._decodeHtmlEntities = function(text) {
    if (!text) return '';
    // Decode entities by string replacement so we preserve HTML (e.g. footnote links).
    // Do &amp; last to avoid double-decoding. Order matters.
    var entityMap = {
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
      '&nbsp;': ' ',
      '&#60;': '<',
      '&#62;': '>',
      '&#34;': '"',
      '&amp;': '&',
      '&#38;': '&'
    };
    var decoded = text;
    for (var entity in entityMap) {
      if (entityMap.hasOwnProperty(entity)) {
        var regex = new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        decoded = decoded.replace(regex, entityMap[entity]);
      }
    }
    return decoded;
  };

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MagnoliaAskAIUI;
  } else {
    global.MagnoliaAskAIUI = MagnoliaAskAIUI;
  }

})(typeof window !== 'undefined' ? window : this);
