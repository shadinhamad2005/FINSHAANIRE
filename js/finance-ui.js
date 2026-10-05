(function () {
    'use strict';
    const purifier = require('dompurify');
    const callbacks = new Map();
    const bound = new WeakMap();
    function register(id, callback) { callbacks.set(id, callback); return id; }
    function handler(callback) { return register(crypto.randomUUID(), callback); }
    function bind(element) {
        const nodes = [...(element.matches?.('*') ? [element] : []), ...element.querySelectorAll('*')];
        for (const node of nodes) for (const attr of [...node.attributes]) {
            if (!attr.name.startsWith('data-finz-')) continue;
            const eventName = attr.name.slice(10), callback = callbacks.get(attr.value);
            if (!callback) continue;
            if (!/^(click|input|change|keydown|keyup|submit|blur|focus)$/.test(eventName)) throw new Error('Unsupported event.');
            node.addEventListener(eventName, function(event) {
                const report = error => {
                    console.error('Action failed:', error.message);
                    node.dispatchEvent(new CustomEvent('finz-action-error', { bubbles: true, detail: error.message }));
                };
                try { Promise.resolve(callback.call(this, event)).catch(report); } catch (error) { report(error); }
            });
            const handlers = bound.get(node) || new Map(); handlers.set(eventName, callback); bound.set(node, handlers);
            callbacks.delete(attr.value); node.removeAttribute(attr.name);
        }
    }
    // Only source-authored templates can create trusted fragments. Markers never enter the DOM.
    const nonce = Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('');
    const begin = `\uE000${nonce}:`, end = `:${nonce}\uE001`;
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function unwrap(value) {
        const text = String(value ?? '');
        let result = '', offset = 0;
        while (offset < text.length) {
            const start = text.indexOf(begin, offset);
            if (start < 0) return result + escape(text.slice(offset));
            result += escape(text.slice(offset, start));
            const stop = text.indexOf(end, start + begin.length);
            if (stop < 0) return result + escape(text.slice(start));
            result += text.slice(start + begin.length, stop);
            offset = stop + end.length;
        }
        return result;
    }
    const literal = text => begin + text + end;
    function html(parts, ...values) {
        let result = parts[0];
        for (let i = 0; i < values.length; i++) {
            const value = values[i];
            const openTag = result.slice(result.lastIndexOf('<'));
            const eventAttr = /\bon\w+\s*=\s*"([^"]*)$/.exec(openTag);
            if (eventAttr) {
                // Values in JavaScript string arguments must be escaped for JS, then HTML.
                const source = eventAttr[1];
                let quote = null, escaped = false;
                for (const c of source) {
                    if (escaped) { escaped = false; continue; }
                    if (c === '\\') { escaped = true; continue; }
                    if (quote) { if (c === quote) quote = null; }
                    else if (c === "'" || c === '"' || c === '`') quote = c;
                }
                if (quote) {
                    result += escape(String(value ?? '').replace(/[\\'"`\r\n<>\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
                } else if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') {
                    result += String(value);
                } else {
                    // Existing navigation callbacks are source-controlled, parameterless calls.
                    const code = String(value ?? '');
                    if (!/^window\.[A-Za-z_$][\w$]*\((?:(?:'[A-Za-z0-9_-]*'|-?\d+(?:\.\d+)?)(?:,\s*(?:'[A-Za-z0-9_-]*'|-?\d+(?:\.\d+)?))*)?\);?$/.test(code)) throw new Error('Unsafe dynamic event handler.');
                    result += escape(code);
                }
            } else {
                const inAttribute = /<[^>]*\s[\w:-]+\s*=\s*["'][^"']*$/.test(openTag);
                result += inAttribute ? escape(value) : unwrap(value);
            }
            result += parts[i + 1];
        }
        return literal(result);
    }
    function setHTML(element, value) {
        if (!element) return;
        const markup = unwrap(value);
        element.innerHTML = typeof purifier.sanitize === 'function'
            ? purifier.sanitize(markup, { FORBID_TAGS: ['script', 'iframe', 'object', 'embed'], FORBID_ATTR: ['srcdoc'] })
            : markup;
        // Block executable URL schemes even when a URL came from data inside a safe attribute.
        for (const node of element.querySelectorAll('[href],[src],[action],[formaction]')) {
            for (const attr of ['href', 'src', 'action', 'formaction']) {
                const url = node.getAttribute(attr);
                if (url && /^(?:(?:javascript|vbscript):|data:text\/html)/i.test(url.replace(/[\u0000-\u0020]/g, ''))) node.removeAttribute(attr);
            }
        }
        if (typeof document !== 'undefined') bind(element);
    }
    function capture(element) {
        const copy = element.cloneNode(true);
        const originals = [element, ...element.querySelectorAll('*')], copies = [copy, ...copy.querySelectorAll('*')];
        originals.forEach((node, i) => {
            for (const [event, callback] of bound.get(node) || []) copies[i].setAttribute('data-finz-' + event, handler(callback));
        });
        return literal(copy.innerHTML);
    }
    module.exports = { html, literal, setHTML, capture, escape, register, handler, bind };
})();
