// CSI解释器，参考
// 字体颜色https://github.com/mozilla-frontend-infra/react-lazylog/blob/master/src/ansiparse.js
const foregroundColors = {
  30: 'black',
  31: 'text-red',
  32: 'text-green',
  33: 'text-orange',
  34: 'text-blue',
  35: 'magenta',
  36: 'text-cyan',
  37: 'white',
  90: 'bright-black',
  91: 'bright-red',
  92: 'bright-green',
  93: 'bright-yellow',
  94: 'bright-blue',
  95: 'bright-magenta',
  96: 'bright-cyan',
  97: 'bright-white',
};
// 字体背景
const backgroundColors = {
  40: 'black',
  41: 'bg-danger',
  42: 'green',
  43: 'yellow',
  44: 'blue',
  45: 'magenta',
  46: 'cyan',
  47: 'white',
  100: 'bright-black',
  101: 'bright-red',
  102: 'bright-green',
  103: 'bright-yellow',
  104: 'bright-blue',
  105: 'bright-magenta',
  106: 'bright-cyan',
  107: 'bright-white',
};
// 文字状态（粗体，斜体，下划线）
const styles = {
  1: 'bold',
  3: 'italic',
  4: 'underline',
};
// Select Graphic Rendition(SGR) flag
const SGRCode = 'm';
// 非SGR，后续可针对该控制符进行解释
const notSGRCodes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'S', 'T', 'f', 's', 'u', 'h', 'l'];

/**
 * 格式化数据类型
 * interface formatter {
 *   text: string,
 *   foreground?: string,
 *   background?: string,
 *   underline?: boolean,
 *   bold?: boolean,
 *   italic?: boolean,
 * }
 **/

/**
 * Backspace操作,即删除最后一个字符
 * matchingText: string,
 * result: formatter[]
 * eraseChar: [string,formatter[]]
 * */

const eraseChar = (matchingText, result) => {
  if (matchingText.length) {
    return [matchingText.substr(0, matchingText.length - 1), result];
  } else if (result.length) {
    const index = result.length - 1;
    const { text } = result[index];
    const newResult =
      text.length === 1
        ? result.slice(0, result.length - 1)
        : result.map((item, i) => (index === i ? { ...item, text: text.substr(0, text.length - 1) } : item));

    return [matchingText, newResult];
  }

  return [matchingText, result];
};

/**
 * str: string
 * ansiParse: formatter[]
 * This Function only translate these codes: 1,3,4,22-24,30-37,39,40-47,49,90-97,100-107.
 * It would be more and more powerful and translate more codes.
 **/

const ansiParse = (str) => {
  let matchingControl = null;
  let matchingCode = null;
  let matchingText = '';
  let ansiState = [];
  let result = [];
  let state = {};

  for (let i = 0; i < str.length; i++) {
    if (matchingControl !== null) {
      if (matchingControl === '\x1b' && str[i] === '[') {
        if (matchingText) {
          state.text = matchingText;
          result.push(state);
          state = {};
          matchingText = '';
        }

        matchingControl = null;
        matchingCode = '';
      } else {
        matchingText += matchingControl + str[i];
        matchingControl = null;
      }

      continue;
    } else if (matchingCode !== null) {
      if (str[i] === ';') {
        ansiState.push(matchingCode);
        matchingCode = '';
      } else if (str[i] === SGRCode) {
        ansiState.push(matchingCode);
        matchingCode = null;
        matchingText = '';

        for (let a = 0; a < ansiState.length; a++) {
          const ansiCode = +ansiState[a];
          if (foregroundColors[ansiCode]) {
            state.foreground = foregroundColors[ansiCode];
          } else if (backgroundColors[ansiCode]) {
            state.background = backgroundColors[ansiCode];
          } else if (ansiCode === 39) {
            delete state.foreground;
          } else if (ansiCode === 49) {
            delete state.background;
          } else if (styles[ansiCode]) {
            state[styles[ansiCode]] = true;
          } else if (ansiCode === 22) {
            state.bold = false;
          } else if (ansiCode === 23) {
            state.italic = false;
          } else if (ansiCode === 24) {
            state.underline = false;
          }
        }

        ansiState = [];
      } else if (notSGRCodes.indexOf(str[i]) > -1) {
        // Ignore codes which is not SGR code and delete them.
        // It should be translated in some day.
        matchingCode = '';
        ansiState = [];
      } else {
        matchingCode += str[i];
      }

      continue;
    }

    if (str[i] === '\x1b') {
      // ESC Control
      matchingControl = str[i];
    } else if (str[i] === '\u0008') {
      // Backspace Control
      [matchingText, result] = eraseChar(matchingText, result);
    } else {
      matchingText += str[i];
    }
  }

  if (matchingText) {
    state.text = matchingText + (matchingControl || '');
    result.push(state);
  }

  return result;
};

export default ansiParse;
