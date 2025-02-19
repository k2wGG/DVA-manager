/*
Полный код с выбором ОС, кошельков, опцией использования прокси,
поддержкой HTTP и SOCKS5-прокси (с ручной обработкой для SOCKS5),
а также с повторными попытками найти и нажать кнопку "Start" (до 3 раз).
*/

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { exec } = require('child_process');
const readline = require('readline');
const chalk = require('chalk');

let globalBrowsers = []; // Массив для хранения запущенных браузеров

// -----------------------
// Константы настройки
// -----------------------
const BASE_URL = 'https://app.gata.xyz/dataAgent';
const ACTIVITY_INTERVAL = 120000; // 2 минуты в мс
const ACTIVE_SESSION_DURATION = 8 * 60 * 60 * 1000; // 8 часов в мс
const PAGE_TIMEOUT = 120000; // 2 минуты
const MAX_RETRY_ATTEMPTS = 3; // Максимальное число попыток для поиска кнопки "Start"

// -----------------------
// ASCII-логотип проекта и глобальные логи
// -----------------------
const asciiLogo = chalk.blue(`
  _   _           _  _____      
 | \\ | |         | ||____ |     
 |  \\| | ___   __| |    / /_ __ 
 | . \` |/ _ \\ / _\` |    \\ \\ '__|
 | |\\  | (_) | (_| |.___/ / |   
 \\_| \\_/\\___/ \\__,_|\\____/|_|   
                                
 Gata DVA Manager — скрипт для автоматики @Nod3r 
`);

const logInfo    = (msg) => console.log(chalk.cyan.bold('ℹ ') + chalk.white(msg));
const logSuccess = (msg) => console.log(chalk.green.bold('✔ ') + chalk.white(msg));
const logWarning = (msg) => console.log(chalk.yellow.bold('⚠ ') + chalk.white(msg));
const logError   = (msg) => console.log(chalk.red.bold('✖ ') + chalk.white(msg));
const logDivider = ()    => console.log(chalk.gray('------------------------------------------------'));

// -----------------------
// Функции для логирования сессий с разными цветами
// -----------------------
function getSessionColor(sessionIndex) {
  const colors = [chalk.red, chalk.green, chalk.yellow, chalk.blue, chalk.magenta, chalk.cyan, chalk.white, chalk.gray];
  return colors[(sessionIndex - 1) % colors.length];
}

function sessionInfo(msg, sessionIndex) {
  const color = getSessionColor(sessionIndex);
  console.log(color.bold(`[Сессия ${sessionIndex}] ℹ `) + chalk.white(msg));
}
function sessionSuccess(msg, sessionIndex) {
  const color = getSessionColor(sessionIndex);
  console.log(color.bold(`[Сессия ${sessionIndex}] ✔ `) + chalk.white(msg));
}
function sessionWarning(msg, sessionIndex) {
  const color = getSessionColor(sessionIndex);
  console.log(color.bold(`[Сессия ${sessionIndex}] ⚠ `) + chalk.white(msg));
}
function sessionError(msg, sessionIndex) {
  const color = getSessionColor(sessionIndex);
  console.log(color.bold(`[Сессия ${sessionIndex}] ✖ `) + chalk.white(msg));
}
function sessionDivider(sessionIndex) {
  const color = getSessionColor(sessionIndex);
  console.log(color.gray(`[Сессия ${sessionIndex}] ------------------------------------------------`));
}

// -----------------------
// Функция выбора ОС
// -----------------------
function chooseOS() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.white.bold('\nВыберите вашу ОС (1 - Windows, 2 - Linux): '), (answer) => {
      rl.close();
      answer = answer.trim();
      if (answer === '1' || answer.toLowerCase() === 'windows') {
        resolve('windows');
      } else if (answer === '2' || answer.toLowerCase() === 'linux') {
        resolve('linux');
      } else {
        logWarning('Неверный выбор. Попробуйте ещё раз.');
        resolve(chooseOS());
      }
    });
  });
}

// -----------------------
// Функция установки зависимостей для Linux
// -----------------------
async function installLinuxDependencies() {
  return new Promise((resolve, reject) => {
    const cmd = `DEBIAN_FRONTEND=noninteractive sudo apt-get install -y xvfb libgbm-dev libxkbcommon-x11-0 libgtk-3-0 libx11-xcb1 libxcb1 libxss1 libnss3 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 libatk1.0-0 libatk-bridge2.0-0 libpango-1.0-0 libpangocairo-1.0-0 libcups2 libdrm2 libxrandr2 libc6 ca-certificates fonts-liberation libappindicator3-1 libgbm1 libnspr4 libnss3 libxcb1 xdg-utils && npx playwright install-deps && npx playwright install`;
    
    logInfo('Устанавливаются зависимости для Linux...Пожалуйста, подождите');
    exec(cmd, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      if (error) {
        logError(`Ошибка при установке зависимостей: ${error.message}`);
        reject(error);
      } else {
        logSuccess('Зависимости для Linux успешно установлены, и браузерные бинарные файлы загружены.');
        resolve();
      }
    });
  });
}



// -----------------------
// Функция выбора конфигураций (кошельков) — одна или все
// -----------------------
function chooseConfigSelection(sessions) {
  return new Promise((resolve) => {
    console.log(chalk.white.bold('\nДоступные сессии:'));
    sessions.forEach((session, idx) => {
      console.log(chalk.white(`${idx + 1}. Адрес: ${session.address}`));
    });
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.white.bold('\nВведите номер конфигурации для запуска или "all" для запуска всех: '), (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === 'all') {
        resolve(sessions); // Запускаем все сессии
      } else {
        const index = parseInt(trimmed, 10) - 1;
        if (!isNaN(index) && index >= 0 && index < sessions.length) {
          resolve(sessions[index]); // Запускаем выбранную сессию
        } else {
          logWarning('Неверный выбор, попробуйте снова.');
          resolve(chooseConfigSelection(sessions));
        }
      }
    });
  });
}

// -----------------------
// Функция запроса, нужен ли прокси
// -----------------------
function askProxyOption() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.white.bold('\nНужен ли прокси? (Y/N): '), (answer) => {
      rl.close();
      answer = answer.trim().toLowerCase();
      resolve(answer === 'y' || answer === 'yes');
    });
  });
}

// -----------------------
// Функция чтения прокси из файла proxy.txt (обработка SOCKS5)
// -----------------------
function readProxiesFromFile() {
  if (!fs.existsSync('proxy.txt')) {
    logError('Файл proxy.txt не найден.');
    return [];
  }
  const data = fs.readFileSync('proxy.txt', 'utf8');
  const lines = data.split('\n').map(l => l.trim()).filter(l => l !== '');
  const proxies = [];
  for (const line of lines) {
    try {
      const url = new URL(line);
      let server;
      if (url.protocol === 'socks5:') {
        // Для SOCKS5 формируем сервер вручную
        server = `socks5://${url.hostname}:${url.port}`;
      } else {
        server = url.origin;
      }
      const proxyObj = { server };
      if (url.username) {
        proxyObj.username = url.username;
      }
      if (url.password) {
        proxyObj.password = url.password;
      }
      proxies.push(proxyObj);
    } catch (e) {
      logWarning(`Не удалось распарсить прокси: ${line}`);
    }
  }
  return proxies;
}

// -----------------------
// Функция очистки старых скриншотов и файлов
// -----------------------
function очиститьСкриншоты() {
  const directory = './';
  fs.readdirSync(directory).forEach(file => {
    if (
      file.startsWith('screenshot-') ||
      file.startsWith('debug-') ||
      file.startsWith('error-') ||
      file.startsWith('verification-') ||
      file.startsWith('current_screenshot_session')
    ) {
      try {
        fs.unlinkSync(path.join(directory, file));
        logWarning(`Удалён файл: ${file}`);
      } catch (err) {
        logError(`Ошибка при удалении файла ${file}: ${err}`);
      }
    }
  });
}

// -----------------------
// Функция создания скриншота с фиксированным именем по sessionIndex
// -----------------------
async function сделатьСкриншот(page, description = '', sessionIndex) {
  const screenshotPath = `current_screenshot_session${sessionIndex}.png`;
  const screenshotBuffer = await page.screenshot();
  fs.writeFileSync(screenshotPath, screenshotBuffer);
  sessionSuccess(`Скриншот сохранён: ${description} (файл: ${screenshotPath})`, sessionIndex);
}

// -----------------------
// Функция установки localStorage (использует переданный config)
// -----------------------
async function установитьLocalStorage(page, config, sessionIndex) {
  await page.evaluate((config) => {
    localStorage.setItem(config.address, config.bearer);
    localStorage.setItem('AGG_USER_IS_LOGIN', '1');
    localStorage.setItem('Gata_Chat_GotIt', '1');
    localStorage.setItem('aggr_current_address', config.address);
    localStorage.setItem(`aggr_llm_token_${config.address}`, config.llm_token);
    localStorage.setItem(`aggr_task_token_${config.address}`, config.task_token);
    localStorage.setItem(`invite_code_${config.address}`, config.invite_code);
    localStorage.setItem('wagmi.recentConnectorId', '"metaMask"');
    localStorage.setItem('wagmi.store', JSON.stringify({
      state: {
        connections: {
          __type: "Map",
          value: [[
            "e52bdc16f63",
            {
              accounts: [config.address],
              chainId: 1017,
              connector: {
                id: "metaMask",
                name: "MetaMask",
                type: "injected",
                uid: "e52bdc16f63"
              }
            }
          ]]
        },
        chainId: 1017,
        current: "e52bdc16f63"
      },
      version: 2
    }));
  }, config);
  sessionSuccess(`Данные localStorage установлены успешно`, sessionIndex);
}

// -----------------------
// Функция ожидания загрузки страницы
// -----------------------
async function дождатьсяЗагрузкиСтраницы(page, sessionIndex) {
  try {
    await Promise.race([
      page.waitForLoadState('domcontentloaded', { timeout: PAGE_TIMEOUT }),
      page.waitForLoadState('load', { timeout: PAGE_TIMEOUT })
    ]);
    await page.waitForTimeout(5000);
    return true;
  } catch (error) {
    sessionWarning('Таймаут загрузки страницы, продолжаем выполнение...', sessionIndex);
    return false;
  }
}

// -----------------------
// Функция имитации активности (принимает sessionIndex)
// -----------------------
async function имитироватьАктивность(page, sessionIndex) {
  try {
    await page.evaluate(() => {
      window.scrollTo(0, 500);
      setTimeout(() => window.scrollTo(0, 0), 1000);
    });
    sessionInfo(`Активность сымитирована: ${new Date().toLocaleTimeString()}`, sessionIndex);
    await сделатьСкриншот(page, 'Имитация активности', sessionIndex);
  } catch (error) {
    sessionError(`Ошибка при имитации активности: ${error.message}`, sessionIndex);
  }
}

// -----------------------
// Функция поиска и нажатия кнопки "Start" с повторными попытками (принимает sessionIndex и attempt)
// -----------------------
async function найтиИНажатьКнопкуСтарт(page, sessionIndex, attempt = 1) {
  sessionInfo(`Поиск кнопки "Start" на странице DVA (попытка ${attempt})...`, sessionIndex);
  sessionDivider(sessionIndex);

  try {
    await сделатьСкриншот(page, 'Перед поиском кнопки "Start"', sessionIndex);

    const currentUrl = page.url();
    if (!currentUrl.includes('/dataAgent')) {
      sessionInfo('Не на странице DVA, переходим...', sessionIndex);
      await page.goto(BASE_URL, { timeout: 60000 }); // 60 секунд
      await дождатьсяЗагрузкиСтраницы(page, sessionIndex);
    }
    await page.waitForTimeout(5000);

    const кнопкаНайдена = await page.evaluate(() => {
      const видима = (elem) => {
        if (!elem) return false;
        const style = window.getComputedStyle(elem);
        return style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.opacity !== '0' &&
               elem.offsetParent !== null;
      };

      const ключевыеСлова = ['start', 'begin', 'launch', 'dva', 'verify'];
      const элементы = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"], div[class*="button"]'));
      for (const элемент of элементы) {
        const текст = элемент.innerText.toLowerCase().trim();
        if (видима(элемент) && ключевыеСлова.some(слово => текст.includes(слово))) {
          элемент.click();
          return true;
        }
      }
      const селекторыКнопок = [
        '[class*="start"]',
        '[class*="begin"]',
        '[class*="launch"]',
        '[class*="verify"]',
        '[class*="dva"]'
      ];
      for (const selector of селекторыКнопок) {
        const найденныеЭлементы = Array.from(document.querySelectorAll(selector))
          .filter(el => видима(el));
        if (найденныеЭлементы.length > 0) {
          найденныеЭлементы[0].click();
          return true;
        }
      }
      return false;
    });

    if (кнопкаНайдена) {
      sessionSuccess(`Кнопка "Start" успешно нажата`, sessionIndex);
      await сделатьСкриншот(page, 'После нажатия кнопки "Start"', sessionIndex);
      return true;
    } else {
      if (attempt < MAX_RETRY_ATTEMPTS) {
        sessionWarning(`Не удалось найти кнопку "Start" (попытка ${attempt}). Повторная попытка...`, sessionIndex);
        await page.waitForTimeout(5000);
        return await найтиИНажатьКнопкуСтарт(page, sessionIndex, attempt + 1);
      } else {
        sessionError(`Не удалось найти кнопку "Start" после ${MAX_RETRY_ATTEMPTS} попыток.`, sessionIndex);
        return false;
      }
    }
  } catch (error) {
    if (attempt < MAX_RETRY_ATTEMPTS) {
      sessionWarning(`Ошибка при поиске кнопки "Start": ${error.message} (попытка ${attempt}). Повторная попытка...`, sessionIndex);
      await page.waitForTimeout(5000);
      return await найтиИНажатьКнопкуСтарт(page, sessionIndex, attempt + 1);
    } else {
      sessionError(`Ошибка при поиске кнопки "Start" после ${MAX_RETRY_ATTEMPTS} попыток: ${error}`, sessionIndex);
      return false;
    }
  }
}

// -----------------------
// Функция поддержки активной сессии (принимает sessionIndex)
// -----------------------
async function поддерживатьСессию(page, sessionIndex) {
  const startTime = Date.now();
  const intervalId = setInterval(async () => {
    if (Date.now() - startTime > ACTIVE_SESSION_DURATION) {
      clearInterval(intervalId);
      sessionWarning('Достигнут лимит времени сессии. Останавливаем активность.', sessionIndex);
      return;
    }
    await имитироватьАктивность(page, sessionIndex);
  }, ACTIVITY_INTERVAL);
  return intervalId;
}

// -----------------------
// Функция запуска автоматизации для одной сессии
// -----------------------
async function startAutomation(config, sessionIndex) {
  sessionDivider(sessionIndex);
  sessionInfo(`Запуск сессии: ${config.address}`, sessionIndex);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  globalBrowsers.push(browser);

  // Формируем опции для контекста, включая прокси, если указано в config
  const contextOptions = {
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };
  if (config.proxy) {
    contextOptions.proxy = config.proxy;
    sessionInfo(`Используется прокси: ${config.proxy.server}`, sessionIndex);
  }
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    sessionInfo('Переход на страницу DVA...', sessionIndex);
    await page.goto(BASE_URL);
    await дождатьсяЗагрузкиСтраницы(page, sessionIndex);

    await установитьLocalStorage(page, config, sessionIndex);
    sessionInfo('Перезагрузка страницы для применения изменений...', sessionIndex);
    await Promise.all([
      page.reload(),
      дождатьсяЗагрузкиСтраницы(page, sessionIndex)
    ]);
    await page.waitForTimeout(5000);

    const кнопкаНажата = await найтиИНажатьКнопкуСтарт(page, sessionIndex);
    if (кнопкаНажата) {
      sessionSuccess('Кнопка "Start" успешно нажата. Запуск имитации активности...', sessionIndex);
      await поддерживатьСессию(page, sessionIndex);
      // Сессия будет работать до прерывания пользователем
    } else {
      sessionError('Не удалось найти кнопку "Start".', sessionIndex);
      await browser.close();
    }
  } catch (error) {
    sessionError(`Ошибка во время выполнения: ${error}`, sessionIndex);
    await сделатьСкриншот(page, 'Критическая ошибка', sessionIndex);
    await browser.close();
  }
}

// -----------------------
// Основная функция запуска
// -----------------------
async function main() {
  console.clear();
  console.log(asciiLogo);
  logInfo('Запуск автоматизации DVA...');
  logDivider();

  // Выбор ОС
  const osChoice = await chooseOS();
  if (osChoice === 'linux') {
    try {
      await installLinuxDependencies();
    } catch (err) {
      logError('Установка зависимостей завершилась ошибкой. Продолжаем выполнение, но возможно софт работать не будет.');
    }
  } else {
    logInfo('Windows-среда обнаружена. Пропускаем установку Linux-зависимостей.');
  }

  очиститьСкриншоты();

  // Загрузка конфигураций (файл configs.json должен содержать объект с массивом sessions)
  const allConfigs = JSON.parse(fs.readFileSync('configs.json', 'utf8'));

  // Выбор конфигурации (одна или все)
  const selected = await chooseConfigSelection(allConfigs.sessions);

  // Запрос, нужен ли прокси
  const needProxy = await askProxyOption();
  if (needProxy) {
    const proxies = readProxiesFromFile();
    if (proxies.length === 0) {
      logWarning('Нет доступных прокси в файле proxy.txt. Продолжаем без прокси.');
    } else {
      if (Array.isArray(selected)) {
        // Распределяем прокси по сессиям по кругу
        selected.forEach((config, idx) => {
          config.proxy = proxies[idx % proxies.length];
        });
      } else {
        selected.proxy = proxies[0];
      }
    }
  }

  if (Array.isArray(selected)) {
    await Promise.all(selected.map((config, idx) => startAutomation(config, idx + 1)));
  } else {
    await startAutomation(selected, 1);
  }
}

// Обработка SIGINT для корректного завершения всех браузеров
process.on('SIGINT', async () => {
  logWarning('\nПолучен сигнал SIGINT. Закрытие всех браузеров...');
  for (const browser of globalBrowsers) {
    try {
      await browser.close();
    } catch (e) { }
  }
  process.exit(0);
});

main();
