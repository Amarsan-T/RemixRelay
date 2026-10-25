// Resolve Tone through Vite exactly as production imports do. Importing the
// optimized file directly without its Vite version can create a second module.
import * as Tone from 'tone'
export { Tone }
