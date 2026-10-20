const stationSuggestions = {
  'station-1': ['time', 'museum', 'debate', 'guide'],
  'station-2': ['oppose', 'site-size', 'debate', 'time'],
  'station-3': ['lamp-walk', 'truth-tree', 'oppose', 'guide'],
  'station-4': ['new-group', 'meaning', 'debate', 'time'],
  'station-5': ['huamao', 'visit', 'meaning', 'guide']
};

const normalise = (text = '') => text
  .toLowerCase()
  .replace(/[\s，。！？、；：“”‘’（）()《》〈〉「」·\-—–,.!?;:'"<>]/g, '');

export function createGuideService({ faqs, llmAdapter = null }) {
  let adapter = llmAdapter;

  const fallback = {
    answer: '这个问题暂时不在现有导览史料中。你可以换一种问法，或点击下面的建议问题。灯灯只回答根据馆方材料整理的内容。',
    source: '史料边界提示',
    matchedId: null
  };

  return {
    setAdapter(nextAdapter) {
      adapter = nextAdapter;
    },

    suggestions(stationId = 'station-1') {
      const ids = stationSuggestions[stationId] || stationSuggestions['station-1'];
      return ids
        .map((id) => faqs.find((item) => item.id === id))
        .filter(Boolean);
    },

    async ask({ question, stationId = 'station-1', mode = 'study' }) {
      const cleanQuestion = String(question || '').trim();
      if (!cleanQuestion) return fallback;

      if (typeof adapter === 'function') {
        try {
          const response = await adapter({ question: cleanQuestion, stationId, mode });
          if (response && response.answer) {
            return {
              answer: response.answer,
              source: response.source || 'AI 导览扩展',
              matchedId: response.matchedId || null
            };
          }
        } catch (error) {
          console.warn('Guide adapter unavailable, using local knowledge base.', error);
        }
      }

      const input = normalise(cleanQuestion);
      let best = null;
      let bestScore = 0;

      for (const item of faqs) {
        let score = 0;
        for (const keyword of item.keywords) {
          const word = normalise(keyword);
          if (word && input.includes(word)) score += Math.max(word.length, 2);
        }

        if (input.includes(normalise(item.question))) score += 12;
        const hints = stationSuggestions[stationId] || [];
        if (hints.includes(item.id)) score += 0.25;

        if (score > bestScore) {
          bestScore = score;
          best = item;
        }
      }

      if (!best || bestScore < 2) return fallback;

      return {
        answer: best.answer,
        source: best.source,
        matchedId: best.id
      };
    }
  };
}