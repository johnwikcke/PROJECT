/**
 * Pop Watch Tracker - Recommendation Engine
 * 
 * To configure AI:
 * 1. Set AI_CONFIG.provider to 'hf' for Hugging Face
 * 2. Add your HF API key to AI_CONFIG.hf_key
 * 3. Optionally adjust model, timeout, and payload limits
 * 
 * Link this page from settings-drawer with:
 * <button class="btn" onclick="window.location.href='recommend.html'">🎲 Recommendations</button>
 */

// AI Configuration
const AI_CONFIG = {
  provider: 'hf',           // Options: 'hf' (Hugging Face)
  hf_key: 'PUT_KEY_HERE',   // Your Hugging Face API key
  model: 'facebook/bart-large-cnn',
  maxCandidates: 20,
  maxPayloadBytes: 8000,
  timeoutMs: 8000
};

// Cache for performance
let allShows = [];
let uniqueTags = [];
let filteredCandidates = [];
let tagMap = {};

// Initialize the recommendation page
function initRecommendationPage() {
  console.log('RECOMMEND_PAGE_INIT');
  
  // Load data from global state or localStorage
  if (window.state && window.state.shows) {
    allShows = window.state.shows;
    console.log(`Loaded ${allShows.length} shows from window.state`);
  } else {
    try {
      const saved = localStorage.getItem('watcher:data:v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        allShows = parsed.shows || [];
        console.log(`Loaded ${allShows.length} shows from localStorage`);
      } else {
        throw new Error('MISSING: window.state or watcher:data:v3');
      }
    } catch (e) {
      alert('No show data found. Please add some shows first.');
      console.error(e.message);
      return;
    }
  }
  
  // Extract unique tags
  extractUniqueTags();
  
  // Render tag checkboxes
  renderTagFilters();
  
  // Set up event listeners
  setupEventListeners();
  
  // Set up back button
  const backButton = document.getElementById('back-button');
  if (backButton) {
    backButton.addEventListener('click', () => {
      window.history.back();
    });
  }
}

// Extract all unique tags from shows
function extractUniqueTags() {
  const tagSet = new Set();
  
  allShows.forEach(show => {
    if (show.tags) {
      if (Array.isArray(show.tags)) {
        show.tags.forEach(tag => tagSet.add(tag.trim().toLowerCase()));
      } else if (typeof show.tags === 'string') {
        show.tags.split(',').forEach(tag => tagSet.add(tag.trim().toLowerCase()));
      }
    }
  });
  
  uniqueTags = Array.from(tagSet).sort();
  console.log(`Found ${uniqueTags.length} unique tags`);
}

// Render tag checkboxes
function renderTagFilters() {
  const tagsContainer = document.getElementById('tags-container');
  if (!tagsContainer) return;
  
  tagsContainer.innerHTML = '';
  
  uniqueTags.forEach(tag => {
    const id = `tag-${tag.replace(/\s+/g, '-')}`;
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tag-checkbox';
    checkbox.id = id;
    checkbox.value = tag;
    
    const label = document.createElement('label');
    label.htmlFor = id;
    label.className = 'tag-label';
    label.textContent = tag;
    
    tagsContainer.appendChild(checkbox);
    tagsContainer.appendChild(label);
    
    // Store reference for easy lookup
    tagMap[tag] = checkbox;
  });
}

// Apply all filters and return matching shows
function applyFilters() {
  const category = document.getElementById('category').value;
  const status = document.getElementById('status').value;
  const searchQuery = document.getElementById('search').value.toLowerCase();
  
  // Get selected tags
  const selectedTags = [];
  uniqueTags.forEach(tag => {
    if (tagMap[tag] && tagMap[tag].checked) {
      selectedTags.push(tag);
    }
  });
  
  // Filter shows
  filteredCandidates = allShows.filter(show => {
    // Category filter
    if (category !== 'all' && show.type !== category) {
      return false;
    }
    
    // Status filter
    if (status !== 'all' && show.status !== status) {
      return false;
    }
    
    // Tags filter (AND logic - all selected tags must be present)
    if (selectedTags.length > 0) {
      let showTags = [];
      
      if (show.tags) {
        if (Array.isArray(show.tags)) {
          showTags = show.tags.map(t => t.trim().toLowerCase());
        } else if (typeof show.tags === 'string') {
          showTags = show.tags.split(',').map(t => t.trim().toLowerCase());
        }
      }
      
      const hasAllTags = selectedTags.every(tag => showTags.includes(tag));
      if (!hasAllTags) return false;
    }
    
    // Search filter
    if (searchQuery) {
      const inTitle = show.title && show.title.toLowerCase().includes(searchQuery);
      const inDescription = show.description && show.description.toLowerCase().includes(searchQuery);
      const inNotes = show.notes && show.notes.toLowerCase().includes(searchQuery);
      
      if (!inTitle && !inDescription && !inNotes) {
        return false;
      }
    }
    
    return true;
  });
  
  // Sort by recently updated
  filteredCandidates.sort((a, b) => {
    const dateA = new Date(a.updatedAt || 0);
    const dateB = new Date(b.updatedAt || 0);
    return dateB - dateA;
  });
  
  console.log(`Filtered to ${filteredCandidates.length} candidates`);
  return filteredCandidates;
}

// Select a show using AI
async function selectWithAI(candidates) {
  const aiToggle = document.getElementById('ai-toggle');
  if (!aiToggle || !aiToggle.checked) {
    return selectRandom(candidates);
  }
  
  // Limit candidates based on config
  const limitedCandidates = candidates.slice(0, AI_CONFIG.maxCandidates);
  
  try {
    // Prepare prompt with candidate information
    let prompt = 'From the following list of candidate shows (title: short_description), select the single best show for tonight.\nReturn valid JSON only: {"title":"...","description":"..."}\nCandidates:\n';
    
    limitedCandidates.forEach((show, index) => {
      const description = show.description || show.notes || show.overview || '';
      // Truncate description to save tokens
      const shortDescription = description.length > 150 ? 
        description.substring(0, 150) + '...' : description;
      
      prompt += `${index + 1}. ${show.title}: ${shortDescription}\n`;
    });
    
    // Check payload size
    if (new Blob([prompt]).size > AI_CONFIG.maxPayloadBytes) {
      console.warn('AI payload too large, falling back to random');
      return selectRandom(candidates);
    }
    
    let result;
    
    // Call appropriate AI provider
    if (AI_CONFIG.provider === 'hf') {
      if (!AI_CONFIG.hf_key || AI_CONFIG.hf_key === 'PUT_KEY_HERE') {
        throw new Error('Hugging Face API key not configured');
      }
      
      result = await fetchHuggingFace(prompt);
    } else {
      throw new Error(`Unsupported AI provider: ${AI_CONFIG.provider}`);
    }
    
    // Try to find the selected show in our candidates
    if (result && result.title) {
      const selectedShow = candidates.find(show => 
        show.title.toLowerCase() === result.title.toLowerCase());
      
      if (selectedShow) {
        return selectedShow;
      }
    }
    
    // If AI selection failed, fall back to random
    console.warn('AI selection failed, falling back to random');
    return selectRandom(candidates);
    
  } catch (error) {
    console.error('AI selection error:', error);
    if (typeof showToast === 'function') {
      showToast('AI failed, showing random pick', false);
    }
    return selectRandom(candidates);
  }
}

// Call Hugging Face API
async function fetchHuggingFace(prompt) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.timeoutMs);
  
  try {
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${AI_CONFIG.model}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AI_CONFIG.hf_key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ inputs: prompt }),
        signal: controller.signal
      }
    );
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Extract JSON from the response
    const jsonMatch = data[0]?.generated_text?.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    throw new Error('No valid JSON found in response');
    
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('AI request timeout');
    }
    throw error;
  }
}

// Select a random show from candidates
function selectRandom(candidates) {
  if (candidates.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * candidates.length);
  return candidates[randomIndex];
}

// Display the recommended show
function showResult(show) {
  const resultPanel = document.getElementById('result');
  const noResults = document.getElementById('no-results');
  
  if (!show) {
    resultPanel.classList.add('hidden');
    noResults.classList.remove('hidden');
    return;
  }
  
  // Create description (first two sentences)
  let description = show.description || show.notes || show.overview || '';
  const sentences = description.split(/[.!?]+/);
  if (sentences.length > 2) {
    description = sentences.slice(0, 2).join('.') + '.';
  }
  
  // Get poster URL
  const posterUrl = show.posterDataUrl || show.posterUrl || '';
  
  resultPanel.innerHTML = `
    ${posterUrl ? `<img src="${posterUrl}" alt="${show.title}" class="result-poster">` : ''}
    <h3 class="result-title">${escapeHtml(show.title)}</h3>
    <p class="result-description">${escapeHtml(description)}</p>
    <button id="open-detail-btn" class="btn-primary">View Details</button>
  `;
  
  // Add event listener to the button
  const detailBtn = document.getElementById('open-detail-btn');
  if (detailBtn) {
    detailBtn.addEventListener('click', () => {
      if (typeof openShowDetail === 'function') {
        openShowDetail(show);
      } else {
        console.error('openShowDetail function not found');
      }
    });
  }
  
  resultPanel.classList.remove('hidden');
  noResults.classList.add('hidden');
}

// Set up all event listeners
function setupEventListeners() {
  const recommendBtn = document.getElementById('recommend-btn');
  const clearFiltersBtn = document.getElementById('clear-filters');
  const filterElements = [
    document.getElementById('category'),
    document.getElementById('status'),
    document.getElementById('search')
  ];
  
  // Add input events to all filter elements
  filterElements.forEach(element => {
    if (element) {
      element.addEventListener('change', applyFilters);
      element.addEventListener('input', applyFilters);
    }
  });
  
  // Add change events to tag checkboxes
  uniqueTags.forEach(tag => {
    if (tagMap[tag]) {
      tagMap[tag].addEventListener('change', applyFilters);
    }
  });
  
  // Recommend button click handler
  if (recommendBtn) {
    recommendBtn.addEventListener('click', async () => {
      const candidates = applyFilters();
      
      if (candidates.length === 0) {
        showResult(null);
        return;
      }
      
      // Show loading state
      recommendBtn.innerHTML = '<span class="loading"></span> Thinking...';
      recommendBtn.disabled = true;
      
      try {
        let selectedShow;
        
        if (document.getElementById('ai-toggle').checked) {
          selectedShow = await selectWithAI(candidates);
        } else {
          selectedShow = selectRandom(candidates);
        }
        
        showResult(selectedShow);
      } catch (error) {
        console.error('Error selecting show:', error);
        showResult(selectRandom(candidates));
      } finally {
        // Reset button state
        recommendBtn.innerHTML = 'Find Recommendation';
        recommendBtn.disabled = false;
      }
    });
  }
  
  // Clear filters button
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      // Reset all filters
      document.getElementById('category').value = 'all';
      document.getElementById('status').value = 'all';
      document.getElementById('search').value = '';
      
      // Uncheck all tags
      uniqueTags.forEach(tag => {
        if (tagMap[tag]) {
          tagMap[tag].checked = false;
        }
      });
      
      // Reapply filters
      applyFilters();
    });
  }
}

// Fallback escapeHtml function if not defined in main app
if (typeof escapeHtml === 'undefined') {
  window.escapeHtml = function(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };
}

// Debug function
window._debugRecommend = function() {
  console.log('=== RECOMMENDATION DEBUG INFO ===');
  console.log('Total shows:', allShows.length);
  console.log('Unique tags:', uniqueTags);
  console.log('Current filtered candidates:', filteredCandidates);
  console.log('Filtered count:', filteredCandidates.length);
  console.log('AI_CONFIG:', AI_CONFIG);
};

// Testing hooks
window._recommendSelectRandom = function() {
  const candidates = applyFilters();
  return selectRandom(candidates);
};

window._recommendSelectAI = function() {
  const candidates = applyFilters();
  return selectWithAI(candidates);
};

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRecommendationPage);
} else {
  initRecommendationPage();
}