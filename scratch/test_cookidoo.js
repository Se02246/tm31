const fs = require('fs');

async function test() {
  const res = await fetch('https://cookidoo.it/recipes/recipe/it-IT/r624855', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  const text = await res.text();
  
  const idx = text.indexOf('recipe-content__right');
  console.log('recipe-content__right snippet:\n', text.slice(idx, idx + 4000));
}

test();
