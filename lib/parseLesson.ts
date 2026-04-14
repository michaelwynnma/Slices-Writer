export interface VocabItem {
  word: string;
  ipa: string;
  chinese: string;
  aux: string;        // 中文辅助发音 (e.g. "嗨尔")
  pronunciation: string;
  mnemonic: string;
}

export interface SentenceItem {
  speaker: string;
  english: string;
  chinese: string;
}

export interface DialogueLine {
  speaker: string;   // e.g. "Robert", "Alice"
  eng: string;       // English sentence (without speaker prefix)
  zh: string;        // Chinese translation
}

export interface LessonData {
  level: string;
  targetGroup: string;
  duration: string;
  title: string;
  objectives: string[];
  introduction: string;
  culturalDifferences: string;
  vocabulary: VocabItem[];
  keySentences: SentenceItem[];
  dialogue: DialogueLine[];
  pronunciationNotes: string[];
  teachingNotes: string[];
}

export function parseLesson(md: string): LessonData {
  const lines = md.split('\n');
  const lesson: LessonData = {
    level: '',
    targetGroup: '',
    duration: '',
    title: '',
    objectives: [],
    introduction: '',
    culturalDifferences: '',
    vocabulary: [],
    keySentences: [],
    dialogue: [],
    pronunciationNotes: [],
    teachingNotes: [],
  };

  let currentSection = '';
  let buffer: string[] = [];

  const flushBuffer = () => {
    const text = buffer.join('\n').trim();
    buffer = [];
    return text;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip horizontal rules
    if (trimmed === '---') continue;

    // Skip comment lines (# format: ...)
    if (trimmed.startsWith('# ') && trimmed.toLowerCase().includes('格式')) continue;
    if (trimmed.startsWith('# ') && (currentSection === 'vocabulary' || currentSection === 'sentences' || currentSection === 'dialogue')) continue;

    // Detect section headers (## or ###)
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      // Save previous section buffer
      const prev = flushBuffer();
      if (currentSection === 'introduction') lesson.introduction = prev;
      if (currentSection === 'cultural') lesson.culturalDifferences = prev;

      const heading = trimmed.replace(/^#+\s*/, '').toLowerCase();

      if (heading.includes('course info') || heading.includes('课程信息')) {
        currentSection = 'info';
      } else if (heading.includes('objectives') || heading.includes('目标')) {
        currentSection = 'objectives';
      } else if (heading.includes('introduction') || heading.includes('课程介绍')) {
        currentSection = 'introduction';
      } else if (heading.includes('cultural') || heading.includes('文化')) {
        currentSection = 'cultural';
      } else if (heading.includes('vocabulary') || heading.includes('词汇')) {
        currentSection = 'vocabulary';
      } else if (heading.includes('key sentence') || heading.includes('核心句')) {
        currentSection = 'sentences';
      } else if (heading.includes('dialogue') || heading.includes('对话')) {
        currentSection = 'dialogue';
      } else if (heading.includes('role map') || heading.includes('角色')) {
        // sub-section of dialogue, stay in dialogue
        currentSection = 'dialogue';
      } else if (heading.includes('conversation')) {
        // sub-section of dialogue
        currentSection = 'dialogue';
      } else if (heading.includes('pronunciation') || heading.includes('发音')) {
        currentSection = 'pronunciation';
      } else if (heading.includes('teaching') || heading.includes('教学')) {
        currentSection = 'teaching';
      } else {
        currentSection = '';
      }
      continue;
    }

    // Title (# heading at top level)
    if (trimmed.startsWith('# ') && currentSection === '') {
      lesson.title = trimmed.replace(/^#\s*/, '');
      continue;
    }

    switch (currentSection) {
      case 'info': {
        // "Level: Beginner" or "- Level: 6" or "**Level:** 6"
        const match = trimmed.match(/[-*]?\s*\*{0,2}(Level|Target Group|Duration|Lesson Duration)\*{0,2}[：:]\s*(.+)/i);
        if (match) {
          const key = match[1].toLowerCase().replace(/\s+/g, '');
          const val = match[2].trim();
          if (key === 'level') lesson.level = val;
          else if (key === 'targetgroup') lesson.targetGroup = val;
          else if (key === 'duration' || key === 'lessonduration') lesson.duration = val;
        }
        break;
      }
      case 'objectives': {
        if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.match(/^\d+\./)) {
          const obj = trimmed.replace(/^[-*\d.]\s*/, '').trim();
          if (obj) lesson.objectives.push(obj);
        }
        break;
      }
      case 'introduction':
      case 'cultural': {
        buffer.push(line);
        break;
      }
      case 'vocabulary': {
        // Format 1: table row | word | /ipa/ | 中文 | 辅助 | 口诀 |
        if (trimmed.startsWith('|') && !trimmed.match(/^\|\s*[-:]+/)) {
          const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
          if (cells.length >= 2 && !cells[0].toLowerCase().includes('word') && !cells[0].toLowerCase().includes('单词')) {
            lesson.vocabulary.push({
              word: cells[0] || '',
              ipa: cells[1] || '',
              chinese: cells[2] || '',
              aux: cells[3] || '',
              pronunciation: cells[4] || '',
              mnemonic: cells[5] || '',
            });
          }
        }
        // Format 2: bullet list "- word | /ipa/ | 中文 | 辅助 | 口诀"
        else if (trimmed.startsWith('-') && trimmed.includes('|')) {
          const content = trimmed.replace(/^-\s*/, '');
          const cells = content.split('|').map(c => c.trim());
          if (cells.length >= 2) {
            lesson.vocabulary.push({
              word: cells[0] || '',
              ipa: cells[1] || '',
              chinese: cells[2] || '',
              aux: cells[3] || '',
              pronunciation: cells[4] || '',
              mnemonic: cells[5] || '',
            });
          }
        }
        break;
      }
      case 'sentences': {
        // Format 1: simple pipe "English | 中文" (no speaker — preferred format)
        if (trimmed.includes('|') && !trimmed.startsWith('|')) {
          const pipeIdx = trimmed.indexOf('|');
          const english = trimmed.substring(0, pipeIdx).trim().replace(/^[-*]\s*/, '');
          const chinese = trimmed.substring(pipeIdx + 1).trim();
          if (english && chinese) {
            lesson.keySentences.push({ speaker: '', english, chinese });
          }
        }
        // Format 2: table row | Speaker | English | Chinese |
        else if (trimmed.startsWith('|') && !trimmed.match(/^\|\s*[-:]+/)) {
          const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
          if (cells.length >= 3 && !cells[0].toLowerCase().includes('speaker')) {
            lesson.keySentences.push({
              speaker: cells[0] || '',
              english: cells[1] || '',
              chinese: cells[2] || '',
            });
          } else if (cells.length === 2 && !cells[0].toLowerCase().includes('english')) {
            // table with just 2 cols: English | Chinese
            lesson.keySentences.push({ speaker: '', english: cells[0], chinese: cells[1] });
          }
        }
        // Format 3: "Speaker: English sentence | Chinese"
        else if (trimmed.includes(':') && trimmed.includes('|')) {
          const colonIdx = trimmed.indexOf(':');
          const speaker = trimmed.substring(0, colonIdx).trim();
          const rest = trimmed.substring(colonIdx + 1).trim();
          const pipeIdx = rest.indexOf('|');
          if (pipeIdx !== -1) {
            const english = rest.substring(0, pipeIdx).trim();
            const chinese = rest.substring(pipeIdx + 1).trim();
            if (english && speaker) {
              lesson.keySentences.push({ speaker, english, chinese });
            }
          }
        }
        break;
      }
      case 'dialogue': {
        // Format: "Speaker: English sentence | 中文翻译"
        if (trimmed.includes(':') && trimmed.includes('|')) {
          const colonIdx = trimmed.indexOf(':');
          const speaker = trimmed.substring(0, colonIdx).trim().replace(/^[-*]\s*/, '');
          const rest = trimmed.substring(colonIdx + 1).trim();
          const pipeIdx = rest.indexOf('|');
          if (pipeIdx !== -1) {
            const eng = rest.substring(0, pipeIdx).trim();
            const zh  = rest.substring(pipeIdx + 1).trim();
            if (speaker && eng) {
              lesson.dialogue.push({ speaker, eng, zh });
            }
          }
        }
        // Format: "English sentence | 中文" (no speaker)
        else if (trimmed.includes('|') && !trimmed.startsWith('|')) {
          const pipeIdx = trimmed.indexOf('|');
          const eng = trimmed.substring(0, pipeIdx).trim().replace(/^[-*]\s*/, '');
          const zh  = trimmed.substring(pipeIdx + 1).trim();
          if (eng) {
            lesson.dialogue.push({ speaker: '', eng, zh });
          }
        }
        break;
      }
      case 'pronunciation': {
        if (trimmed && !trimmed.match(/^#+/)) {
          lesson.pronunciationNotes.push(trimmed.replace(/^[-*]\s*/, ''));
        }
        break;
      }
      case 'teaching': {
        if (trimmed && !trimmed.match(/^#+/)) {
          lesson.teachingNotes.push(trimmed.replace(/^[-*]\s*/, ''));
        }
        break;
      }
    }
  }

  // Flush any remaining buffer
  const remaining = flushBuffer();
  if (currentSection === 'introduction') lesson.introduction = remaining;
  if (currentSection === 'cultural') lesson.culturalDifferences = remaining;

  return lesson;
}
