const express = require('express');
const multer = require('multer');
const gettextParser = require('gettext-parser');
const https = require('https');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));

// Google Translate API fallback helper
async function translateText(text, fromLang, toLang) {
    if (!text || text.trim() === '') return text;

    let placeholders = [];
    // Protect variables and HTML tags
    let preparedText = text.replace(/(%[0-9]*\$?[a-zA-Z]|&[a-zA-Z]+;|<\/?[\w\s="'-]+>)/g, (match) => {
        let idx = placeholders.length;
        placeholders.push(match);
        return ` ZPZ${idx}ZPZ `; // Using a unique token that survives translation
    });

    return new Promise((resolve) => {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(preparedText)}`;
        https.get(url, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    let translated = '';
                    if (json[0]) {
                        json[0].forEach(t => {
                            if (t[0]) translated += t[0];
                        });
                    }
                    
                    // Restore placeholders (Google Translate often transliterates ZPZ to ЗПЗ in Russian)
                    for (let i = 0; i < placeholders.length; i++) {
                        let regex = new RegExp(`\\s*(Z|З)\\s*(P|П)\\s*(Z|З)\\s*${i}\\s*(Z|З)\\s*(P|П)\\s*(Z|З)\\s*`, 'gi');
                        
                        // We put spaced around placeholder so words don't merge, e.g. "Обзор%s" -> "Обзор %s"
                        translated = translated.replace(regex, ` ${placeholders[i]} `);
                    }
                    
                    // Clean up extra spaces around colons or punctuation if any
                    translated = translated.replace(/\s+/g, ' ').trim();
                    translated = translated.replace(/\s+:/g, ":"); 
                    translated = translated.replace(/\s+\./g, ".");
                    
                    resolve(translated || text);
                } catch (e) {
                    resolve(text);
                }
            });
        }).on('error', () => resolve(text));
    });
}

app.post('/api/translate', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { fromLang = 'en', toLang = 'ru', exclusions = '', untranslatedAction = 'keep' } = req.body;
        console.log(`Translating from ${fromLang} to ${toLang}...`);

        // Parse exclusions
        const exclusionList = exclusions
            .split(/[\n,]+/)
            .map(w => w.trim())
            .filter(w => w.length > 0)
            .map(w => w.toLowerCase());

        const fileBuffer = fs.readFileSync(req.file.path);
        let parsed;
        
        try {
            parsed = gettextParser.po.parse(fileBuffer);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid PO/POT file format.' });
        }

        // Setup headers
        parsed.headers['Language'] = toLang;
        parsed.headers['X-Generator'] = 'WP Translate JS';
        
        // Basic Russian Plurals (you can expand this logic for other languages)
        if (toLang === 'ru') {
            parsed.headers['Plural-Forms'] = 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);';
        }

        let stringsToTranslate = [];

        for (const context of Object.keys(parsed.translations)) {
            for (const msgid of Object.keys(parsed.translations[context])) {
                const entry = parsed.translations[context][msgid];
                if (!msgid) continue;
                
                // Ensure we don't re-translate if it's already translated and not empty, unless requested
                const hasPlural = !!entry.msgid_plural;
                
                stringsToTranslate.push({
                    entry,
                    hasPlural,
                    text: msgid
                });
                
                if (hasPlural) {
                    stringsToTranslate.push({
                        entry,
                        hasPlural: true,
                        isPluralForm: true,
                        text: entry.msgid_plural
                    });
                }
            }
        }

        console.log(`Processing ${stringsToTranslate.length} items...`);
        
        // Notify client we've started via SSE or just long polling (simple implementation shown here)
        // For production, use WebSockets or SSE for progress tracking
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // Need to flush headers first
        res.write(`data: ${JSON.stringify({ status: 'started', total: stringsToTranslate.length })}\n\n`);

        let count = 0;
        
        for (const item of stringsToTranslate) {
            let translated = '';
            
            // Check if item contains any excluded words
            const lowerText = item.text.toLowerCase();
            const isExcluded = exclusionList.some(excludedWord => {
                // We use word boundaries or exact match to avoid partial matches
                // E.g., if excludedWord is 'shop', we don't want to exclude 'shopping'
                return lowerText === excludedWord || new RegExp(`\\b${excludedWord}\\b`, 'i').test(lowerText);
            });

            if (isExcluded) {
                // Apply the selected action for excluded items
                translated = untranslatedAction === 'keep' ? item.text : '';
            } else {
                translated = await translateText(item.text, fromLang, toLang);
            }
            
            if (item.hasPlural) {
                if (!item.entry.msgstr) item.entry.msgstr = ['', '', ''];
                
                if (item.isPluralForm) {
                    // Rough mapping for plural forms
                    item.entry.msgstr[1] = translated;
                    if(parsed.headers['Plural-Forms'] && parsed.headers['Plural-Forms'].includes('nplurals=3')) {
                        item.entry.msgstr[2] = translated;
                    }
                } else {
                    item.entry.msgstr[0] = translated;
                    if(item.entry.msgstr.length < 2) {
                        item.entry.msgstr = [translated, translated];
                    }
                }
            } else {
                item.entry.msgstr = [translated];
            }
            
            count++;
            
            // Send progress update
            if (count % 10 === 0 || count === stringsToTranslate.length) {
                res.write(`data: ${JSON.stringify({ status: 'progress', current: count, total: stringsToTranslate.length })}\n\n`);
            }
            
            if (!isExcluded) {
                await new Promise(r => setTimeout(r, 150)); // rate limiting only for API calls
            }
        }

        // Compile back to PO bytes
        const compiled = gettextParser.po.compile(parsed);
        const outName = `translated_${Date.now()}.po`;
        const outPath = path.join(__dirname, 'uploads', outName);
        fs.writeFileSync(outPath, compiled);
        
        res.write(`data: ${JSON.stringify({ status: 'completed', fileUrl: `/download/${outName}` })}\n\n`);
        res.end();

        // Cleanup original
        fs.unlinkSync(req.file.path);

    } catch (err) {
        console.error(err);
        res.write(`data: ${JSON.stringify({ status: 'error', message: err.message })}\n\n`);
        res.end();
    }
});

app.get('/download/:filename', (req, res) => {
    const file = path.join(__dirname, 'uploads', req.params.filename);
    res.download(file, 'ru.po', (err) => {
        if (!err) {
            // Clean up after download
            setTimeout(() => fs.unlinkSync(file), 5000);
        }
    });
});

app.listen(PORT, () => {
    console.log(`WP Translate API listening on http://localhost:${PORT}`);
});
