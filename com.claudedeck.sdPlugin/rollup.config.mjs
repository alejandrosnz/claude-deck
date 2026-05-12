import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/plugin.ts',
  output: {
    file: 'bin/plugin.js',
    format: 'cjs',
    sourcemap: false,
    interop: 'auto',
    exports: 'auto',
  },
  plugins: [
    nodeResolve({ preferBuiltins: true, exportConditions: ['node'] }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json' }),
  ],
  onwarn(warning, warn) {
    // Suppress known-harmless circular dependency warnings inside @elgato/streamdeck
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    warn(warning);
  },
};
