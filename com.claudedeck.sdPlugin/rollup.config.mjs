import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/plugin.ts',
  output: {
    file: 'bin/plugin.js',
    format: 'esm',
    sourcemap: false,
  },
  plugins: [
    nodeResolve({ preferBuiltins: true, exportConditions: ['node'] }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json' }),
  ],
  onwarn(warning, warn) {
    // Suppress circular-dependency warnings that originate entirely inside
    // node_modules. Warnings involving our own src/ files are surfaced so we
    // notice accidental cycles during development.
    if (
      warning.code === 'CIRCULAR_DEPENDENCY' &&
      (warning.ids ?? []).every((id) => id.includes('node_modules'))
    ) return;
    warn(warning);
  },
};
