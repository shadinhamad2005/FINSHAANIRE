module.exports = {
    content: ['./index.html', './src/**/*.js', './js/finance-runtime.js'],
    safelist: [{ pattern: /^(bg|text|border)-(rose|emerald|slate|amber|indigo|blue|purple|red|green)-(50|100|200|300|400|500|600|700|800|900|950)$/, variants: ['hover', 'focus'] }],
    theme: { extend: {} }, plugins: []
};
