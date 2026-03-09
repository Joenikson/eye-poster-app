# Multilingual Face Sketch Poster Generator

An AI-inspired creative web application that transforms a portrait image into an artistic poster.
This system takes the face from an uploaded image, sketches over the face and then wraps the users name around the body in multiple Indian languages.

This project integrates several aspects, including image processing, canvas rendering, and multilingual typography in order to generate a new and different poster each time it is loaded.


## Features

**Portrait Upload**

* Upload a portrait image from the device.

**Automatic Face Detection**

* Detects and extracts the face region from the image.

**Pencil Sketch Conversion**

* Uses the Canvas library to apply a Face Recognition detection to the live video stream and then transforms the detected face into a stylized sketch via the image processing library provided by Canvas.

**Multilingual Name Rendering**

* Translates the user’s name into multiple Indian languages.

Languages supported:

* English
* Hindi
* Tamil
* Telugu
* Kannada
* Malayalam
* Bengali
* Gujarati
* Punjabi
* Marathi
* Odia

**Poster Layout Generation**

* Places the sketch in the center of the canvas.
* Distributes multilingual text around the sketch to create a visual pattern.

**Poster Preview**

* You can see the poster that we generated in the image above before downloading.

**Download Poster**

* Export the poster as a high-resolution image.

---

## Technology Stack

Frontend

* React
* HTML5 Canvas API
* JavaScript (ES6)

Image Processing

* Canvas Pixel Manipulation
* Edge detection techniques
* Sketch style rendering

Translation

* Google Translate API endpoint

Development Tools

* Node.js
* npm
* Visual Studio Code
* Git

Version Control

* GitHub

---

## Application Workflow

The application follows the pipeline below:

1. User uploads portrait image
2. Face detection extracts the face region
3. Canvas processes the image and generates a sketch effect
4. User name is translated into multiple Indian languages
5. Poster layout engine distributes the translated names around the canvas
6. Final poster preview is generated
7. User downloads the poster

---

## Installation

Clone the repository

```bash
git clone https://github.com/yourusername/multilingual-face-sketch-poster-generator.git
```

Navigate to the project directory

```bash
cd multilingual-face-sketch-poster-generator
```

Install dependencies

```bash
npm install
```

Start the development server

```bash
npm start
```

Open in browser

```
http://localhost:3000
```

---

## Project Structure

```
src
├── components
│    ├── ImageUploader
│    ├── PosterCanvas
│
├── utils
│    ├── faceDetection
│    ├── sketchGenerator
│    └── translateName
│
├── App.js
└── index.js
```

---

## Future Improvements

Planned enhancements for the project:

* Improved face detection accuracy
* Advanced sketch rendering algorithm
* Better typography layout around the face
* Live poster preview improvements
* Mobile responsive design
* Theme customization for poster styles
* Support for additional languages

---

## Use Cases

This project can be used for:

* Creative portrait posters
* Multilingual typography art
* Social media profile posters
* Learning Canvas image processing
* Experimenting with generative UI design

---

## Contributing

Contributions are welcome.

If you would like to improve this project:

1. Fork the repository
2. Create a new branch
3. Make your changes
4. Submit a pull request

---

## License

This project is released under the MIT License.

---

## Author

Joenikson

If you found this project interesting you can leave a star on GitHub.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
