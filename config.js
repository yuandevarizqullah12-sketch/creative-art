/*
 * Creative Art: client configuration.
 * Nothing in this file is secret. Cloudflare credentials only ever live in
 * server-side environment variables (see api/generate.js and README.md).
 *
 * The style ids and aspect ids below must match the allow-lists in
 * api/generate.js; the server rejects anything it does not recognise.
 */
window.CREATIVE_ART_CONFIG = Object.freeze({
  apiEndpoint: '/api/generate',
  maxPromptLength: 1000,
  requestTimeoutMs: 45000,
  defaultStyle: 'realistic',
  defaultRatio: '1:1',

  styles: [
    { id: 'realistic', label: 'Realistic' },
    { id: 'anime', label: 'Anime' },
    { id: '3d-render', label: '3D Render' },
    { id: 'fantasy', label: 'Fantasy' },
    { id: 'watercolor', label: 'Watercolor' },
    { id: 'pixel-art', label: 'Pixel Art' },
    { id: 'surrealism', label: 'Surrealism' },
    { id: 'digital-painting', label: 'Digital Painting' }
  ],

  // FLUX.1 schnell has no width/height input. The model returns its own fixed
  // size, and the browser centre-crops it to the chosen shape.
  ratios: [
    { id: '1:1', label: 'Square', detail: '1:1' },
    { id: '16:9', label: 'Landscape', detail: '16:9' },
    { id: '3:4', label: 'Portrait', detail: '3:4' }
  ],

  examplePrompts: [
    'A fox reading by lantern light in a snowy forest',
    'Floating islands above a sea of clouds at sunrise',
    'A retro-futuristic train station in the rain',
    'A glass greenhouse on Mars, lit from within'
  ],

  ideas: [
    { style: 'realistic', prompt: 'A fisherman mending nets on a misty harbor at dawn' },
    { style: 'realistic', prompt: 'A rain-soaked night market with neon reflections on the pavement' },
    { style: 'anime', prompt: 'A girl with a paper lantern walking through a quiet mountain village at dusk' },
    { style: 'anime', prompt: 'Two rival chefs facing off in a rooftop kitchen, wind blowing their aprons' },
    { style: '3d-render', prompt: 'A tiny cozy library inside a glass terrarium, warm lamps and miniature books' },
    { style: '3d-render', prompt: 'A friendly round robot watering plants on a floating garden island' },
    { style: 'fantasy', prompt: 'A lighthouse on a cliff guiding dragons home through a storm' },
    { style: 'fantasy', prompt: 'An ancient tree city lit by drifting lanterns above a silver river' },
    { style: 'watercolor', prompt: 'A field of poppies with a red bicycle leaning on a wooden fence' },
    { style: 'watercolor', prompt: 'Rooftops of an old coastal town after rain, in soft pink and blue washes' },
    { style: 'pixel-art', prompt: 'A train crossing a snowy forest at night, seen from the hillside' },
    { style: 'pixel-art', prompt: 'A tiny wizard shop on a busy city street with a glowing sign' },
    { style: 'surrealism', prompt: 'A staircase made of clouds leading to a door standing in the ocean' },
    { style: 'surrealism', prompt: 'A giant clock melting over a quiet desert town at twilight' },
    { style: 'digital-painting', prompt: 'An astronaut resting beside a campfire on a violet alien beach' },
    { style: 'digital-painting', prompt: 'A desert caravan passing a colossal ruined statue under twin moons' }
  ]
});
