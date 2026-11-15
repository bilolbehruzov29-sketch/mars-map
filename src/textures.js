// ==========================================
// ТЕКСТУРЫ: процедурные макеты слоёв (пока нет данных NASA)
// ==========================================

import * as THREE from 'three';

// Цвета для каждого слоя: от тёмного к светлому
const PALETTES = {
  optical: ['#5d3025', '#a85b3b', '#d18a5b', '#713c2e'],

  thermal: ['#171b43', '#3456a1', '#e28b39', '#f4d56b'],

  spectral: ['#192f54', '#268a8b', '#b4a64e', '#c66a4b'],

  topographic: ['#203f38', '#6e8d57', '#c5a36b', '#e0d1a2'],

  geophysical: ['#172a49', '#465b85', '#9a5574', '#d5a078'],

  atmospheric: ['#182b47', '#497c9a', '#b1c7c6', '#e4d7b9'],

  radiation: ['#171d36', '#5a3c83', '#c04d58', '#f0a34a'],

  chemical: ['#263c38', '#4b8a68', '#c6b45c', '#bb654d']
};

// Генератор псевдослучайного шума
function seededNoise(x, y, seed = 1) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;

  return n - Math.floor(n);
}

// Рисует canvas-текстуру 1024×512 для слоя type
export function makeTexture(type, anisotropy = 1) {
  const canvas = document.createElement('canvas');

  canvas.width = 1024;
  canvas.height = 512;

  const ctx = canvas.getContext('2d');

  const colors = PALETTES[type];

  const image = ctx.createImageData(canvas.width, canvas.height);

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const nx = x / canvas.width;
      const ny = y / canvas.height;

      const broad = (Math.sin(nx * 22 + Math.cos(ny * 13)) + Math.cos(ny * 19 - nx * 8)) * 0.22;

      const fine = seededNoise(Math.floor(x / 5), Math.floor(y / 5), type.length) * 0.42;

      const band = Math.sin((nx * 3.2 + Math.sin(ny * 8) * 0.15) * Math.PI * 2) * 0.12;

      const value = Math.max(0, Math.min(0.999, 0.42 + broad + fine + band));

      const index = Math.min(3, Math.floor(value * 4));

      const c1 = new THREE.Color(colors[index]);

      const c2 = new THREE.Color(colors[Math.min(index + 1, 3)]);

      const mix = (value * 4) % 1;

      c1.lerp(c2, mix * 0.35);

      const i = (y * canvas.width + x) * 4;

      image.data[i] = Math.round(c1.r * 255);
      image.data[i + 1] = Math.round(c1.g * 255);
      image.data[i + 2] = Math.round(c1.b * 255);
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);

  // Дополнительные детали текстур

  ctx.globalAlpha = 0.16;

  if (type === 'topographic') {
    ctx.strokeStyle = '#fff0c2';
    ctx.lineWidth = 1;

    for (let r = 24; r < 230; r += 22) {
      ctx.beginPath();

      ctx.ellipse(510, 260, r * 2.1, r * 0.72, -0.3, 0, Math.PI * 2);

      ctx.stroke();
    }
  } else if (type === 'spectral' || type === 'chemical') {
    for (let i = 0; i < 65; i++) {
      ctx.fillStyle = i % 2 ? '#f6e5a0' : '#173d69';

      ctx.beginPath();

      ctx.arc(
        seededNoise(i, 2, 8) * 1024,
        seededNoise(i, 5, 4) * 512,
        5 + (i % 8) * 2,
        0,
        Math.PI * 2
      );

      ctx.fill();
    }
  } else {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;

    for (let i = 0; i < 34; i++) {
      const x = seededNoise(i, 1, 2) * 1024;
      const y = seededNoise(i, 7, 3) * 512;

      ctx.beginPath();

      ctx.arc(x, y, 8 + (i % 7) * 4, 0, Math.PI * 2);

      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);

  texture.colorSpace = THREE.SRGBColorSpace;

  texture.anisotropy = anisotropy;

  return texture;
}