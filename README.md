# Multilingual Face Sketch Poster Generator

Upload a portrait and get a pencil-sketch poster with your name written around it in English and 10 Indian languages.

**[Live demo](https://eye-poster-app.vercel.app)**

## What it does

Detects the face in an uploaded photo, converts it to a pencil sketch on an HTML5 canvas, then arranges your name around the sketch in Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Gujarati, Punjabi, Marathi and Odia, plus English. Preview the poster and download it as a PNG.

## Features

- **Portrait upload** from your device
- **Face detection** with face-api.js (TinyFaceDetector). If no face is found, it falls back to a landmark-guided crop and then to a centered portrait crop.
- **Pencil-sketch rendering** with a dodge-blend pipeline on canvas pixels
- **Multilingual name rendering:** the name is translated into 10 Indian languages and laid out around the sketch
- **Preview and download** as an image

## How it works

1. Upload a portrait and enter a name
2. face-api.js finds the face, with fallbacks if detection fails
3. The face is cropped and converted to a pencil sketch on canvas
4. The name is translated into each supported language
5. The layout step places the translated names around the sketch
6. Preview the poster and download the PNG

## Tech stack

- **Front end:** React 19, Vite, JavaScript (ES6)
- **Graphics:** HTML5 Canvas API, pixel manipulation, dodge-blend sketch effect
- **Face detection:** face-api.js, loaded from a CDN at runtime
- **Translation:** Google Translate web endpoint
- **Tooling:** Node.js, npm, ESLint, Git
- **Deployment:** Vercel

## Run locally

```bash
git clone https://github.com/Joenikson/eye-poster-app.git
cd eye-poster-app
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`). An internet connection is needed for the face-detection models and translation.

## Project structure

```
eye-poster-app
├── public/            static assets
├── src/
│   ├── App.jsx        UI, face detection, sketch pipeline, poster layout
│   ├── main.jsx       entry point
│   └── *.css          styles
├── index.html
├── vite.config.js
└── eslint.config.js
```

## Roadmap

- Split `App.jsx` into components and utility modules
- Improve sketch shading
- Smarter text layout around the face
- Poster themes and more languages
- Move translation behind an official API

## License

MIT. See [LICENSE](LICENSE).

## Author

**Joe Nikson**: [GitHub](https://github.com/Joenikson)
