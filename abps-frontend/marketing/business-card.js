let fileFront = null, fileBack = null;
document.getElementById('card-front').onchange = (e) => {
  fileFront = e.target.files[0];
  document.getElementById('front-box').textContent = "Front ✅";
  document.getElementById('front-box').classList.add('done');
  document.getElementById('parse-btn').disabled = false;
};
document.getElementById('card-back').onchange = (e) => {
  fileBack = e.target.files[0];
  document.getElementById('back-box').textContent = "Back ✅";
  document.getElementById('back-box').classList.add('done');
};

/**
 * CLIENT-SIDE FUZZY PRE-FILTER
 * Scores catalog items against a query by word overlap.
 * Used by both ItemCode Search and Store Entry matching.
 * Returns top N candidates sorted by score descending.
 */
function fuzzyPreFilterCatalog(query, catalog, topN) {
  if (!query || !catalog || catalog.length === 0) return [];
  
  const queryWords = query.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
  
  if (queryWords.length === 0) return catalog.slice(0, topN);
  
  const scored = catalog.map(item => {
    const nameNorm = (item.productName || "").toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const nameWords = nameNorm.split(/\s+/).filter(w => w.length > 1);
    
    let score = 0;
    
    queryWords.forEach(qw => {
      // Exact word match — highest score
      if (nameWords.includes(qw)) {
        score += 10;
        return;
      }
      // Partial match — query word starts with or contains name word
      nameWords.forEach(nw => {
        if (nw.startsWith(qw) || qw.startsWith(nw)) score += 6;
        else if (nw.includes(qw) || qw.includes(nw)) score += 3;
        // Fuzzy: if words share first 4+ characters (handles plurals, typos)
        else if (qw.length >= 4 && nw.length >= 4 && qw.substring(0, 4) === nw.substring(0, 4)) score += 4;
      });
    });
    
    // Bonus: item code direct match
    const codeNorm = (item.itemCode || "").toLowerCase();
    if (codeNorm.includes(query.toLowerCase())) score += 20;
    
    return { ...item, _score: score };
  });
  
  return scored
    .filter(i => i._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, topN)
    .map(({ _score, ...item }) => item);
}

