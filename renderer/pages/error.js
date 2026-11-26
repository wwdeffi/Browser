'use strict';

(() => {
  const params = new URLSearchParams(window.location.search);
  const rawCode = params.get('code') || '';
  const rawDesc = (params.get('desc') || 'ERR_FAILED').toUpperCase();
  const rawUrl = params.get('url') || '';

  const titleEl = document.getElementById('error-title');
  const subtitleEl = document.getElementById('error-subtitle');
  const urlEl = document.getElementById('error-url');
  const tipsEl = document.getElementById('error-tips');
  const codeEl = document.getElementById('error-code');
  const badgeEl = document.getElementById('icon-badge');
  const retryBtn = document.getElementById('btn-retry');
  const backBtn = document.getElementById('btn-back');
  const httpsBackBtn = document.getElementById('btn-https-back');
  const httpsProceedBtn = document.getElementById('btn-https-proceed');
  const isHttpsOnly = rawDesc === 'HTTPS_ONLY_UNAVAILABLE';
  // Ошибка сертификата: kind=cert и local=1 выставляет main. local влияет только на показ кнопки;
  // main всё равно сам проверяет локальность и разрешает исключение лишь по своему состоянию вкладки
  const isCert = params.get('kind') === 'cert';
  const isLocalCert = isCert && params.get('local') === '1';
  const rawFingerprint = (params.get('fp') || '').slice(0, 200);
  const certFpEl = document.getElementById('cert-fp');
  const certBackBtn = document.getElementById('btn-cert-back');
  const certProceedBtn = document.getElementById('btn-cert-proceed');

  const CERT_REASONS = [
    ['CERT_AUTHORITY_INVALID', 'Сертификат выдан неизвестным центром сертификации или подписан самим сайтом (самоподписанный).'],
    ['CERT_DATE_INVALID', 'Срок действия сертификата истёк или ещё не наступил.'],
    ['CERT_COMMON_NAME_INVALID', 'Имя в сертификате не совпадает с адресом, который вы открываете.'],
    ['CERT_REVOKED', 'Сертификат отозван издателем.'],
    ['CERT_UNABLE_TO_CHECK_REVOCATION', 'Не удалось проверить, не отозван ли сертификат.'],
    ['CERT_WEAK', 'Сертификат использует устаревший или слабый алгоритм подписи или ключ.'],
    ['CERT_NAME_CONSTRAINT_VIOLATION', 'Сертификат нарушает ограничения на имена, заданные его издателем.'],
    ['CERT_', 'Сертификат безопасности сайта недействителен или повреждён.']
  ];

  // Ошибка сертификата: тип ошибки из desc, для локальных адресов — пояснение про разовое исключение
  function resolveCertInfo(desc) {
    const found = CERT_REASONS.find(([key]) => desc.includes(key));
    const reason = found ? found[1] : 'Не удалось проверить сертификат безопасности этого сайта.';

    if (isLocalCert) {
      return {
        title: 'Сертификат локального сервера не прошёл проверку',
        subtitle: reason,
        danger: true,
        tips: [
          'Это адрес вашего компьютера или локальной сети. Если сервер запущен вами, можно продолжить.',
          'Исключение разовое: оно действует только для этого адреса и этого сертификата и только до закрытия браузера. Другой сертификат снова покажет это предупреждение.',
          'Для разработки удобнее выпустить доверенный локальный сертификат (например, через mkcert).',
          'Если вы не запускали этот сервер, не продолжайте и не вводите пароли.'
        ]
      };
    }
    return {
      title: 'Соединение не защищено',
      subtitle: reason,
      danger: true,
      tips: [
        'Злоумышленник мог подменить сайт, чтобы перехватить ваши данные.',
        'Не вводите пароли, данные банковских карт и другую личную информацию.',
        'Проверьте системную дату и время. В публичной Wi-Fi сети может требоваться вход на её стартовой странице.',
        'Открыть такой сайт в этом браузере нельзя. Если он вам действительно нужен, сообщите о проблеме его владельцам.'
      ]
    };
  }

  // Режим «Только HTTPS»: попытка открыть http-адрес по https:// не удалась
  function resolveHttpsOnlyInfo(code) {
    const n = Number(code);
    let reason = 'Не удалось установить защищённое соединение с этим сайтом.';
    if (n === -118) reason = 'Сайт не ответил по HTTPS за отведённое время.';
    else if (n === -310) reason = 'Сайт бесконечно перенаправляет между http:// и https://.';
    else if (n <= -200 && n > -300) reason = 'Сертификат безопасности сайта недействителен или не может быть проверен.';
    else if (n === -102) reason = 'Сайт отклонил подключение по HTTPS (порт 443 закрыт).';
    return {
      title: 'Сайт не поддерживает защищённое соединение',
      subtitle: `Включён режим «Только HTTPS». ${reason}`,
      danger: true,
      tips: [
        'Открыть сайт по HTTP можно, но данные между вами и сайтом будут передаваться без шифрования: их могут увидеть или изменить посторонние.',
        'Не вводите пароли, данные банковских карт и другую личную информацию на таком сайте.',
        'Исключение действует только до закрытия браузера.'
      ]
    };
  }

  function resolveErrorInfo(desc) {
    if (desc === 'HTTPS_ONLY_UNAVAILABLE') return resolveHttpsOnlyInfo(rawCode);
    if (isCert) return resolveCertInfo(desc);

    if (desc.startsWith('RENDERER_')) {
      if (desc.includes('OOM')) {
        return {
          title: 'Не хватило памяти для вкладки',
          subtitle: 'Вкладка была остановлена, потому что закончилась доступная память.',
          danger: true,
          tips: [
            'Закройте лишние вкладки и тяжёлые приложения, затем повторите попытку.',
            'Если страница тяжёлая (игры, большие таблицы, видео), откройте её в одной вкладке.'
          ]
        };
      }
      if (desc.includes('KILLED')) {
        return {
          title: 'Вкладка была остановлена',
          subtitle: 'Процесс этой страницы был принудительно завершён.',
          danger: true,
          tips: [
            'Возможно, процесс завершил диспетчер задач или антивирус.',
            'Нажмите «Повторить попытку», чтобы загрузить страницу заново.'
          ]
        };
      }
      return {
        title: 'Вкладка аварийно завершилась',
        subtitle: 'При работе этой страницы произошёл сбой, и вкладку пришлось остановить.',
        danger: true,
        tips: [
          'Нажмите «Повторить попытку» — чаще всего страница загружается нормально.',
          'Если сбой повторяется, закройте лишние вкладки или перезапустите браузер.',
          'Проверьте, не конфликтуют ли с браузером антивирус или драйверы видеокарты.'
        ]
      };
    }

    if (desc.includes('INTERNET_DISCONNECTED') || desc.includes('NETWORK_CHANGED')) {
      return {
        title: 'Нет подключения к интернету',
        subtitle: 'Компьютер сейчас не подключён к сети.',
        danger: false,
        tips: [
          'Проверьте подключение Wi-Fi или сетевой кабель.',
          'Попробуйте перезагрузить роутер.',
          'Убедитесь, что не включён «Режим в самолёте».'
        ]
      };
    }

    if (desc.includes('NAME_NOT_RESOLVED') || desc.includes('NAME_RESOLUTION')) {
      return {
        title: 'Не удалось найти сайт',
        subtitle: 'Сервер с таким доменным именем не найден.',
        danger: false,
        tips: [
          'Проверьте адрес в адресной строке на опечатки.',
          'Убедитесь, что сайт существует и доступен.',
          'Если проблема со всеми сайтами — проверьте настройки DNS или VPN.'
        ]
      };
    }

    if (desc.includes('CONNECTION_REFUSED')) {
      return {
        title: 'Сайт отклонил подключение',
        subtitle: 'Сервер доступен, но не принимает соединения по этому адресу.',
        danger: false,
        tips: [
          'Если вы открываете локальный адрес (localhost), проверьте, запущен ли сервер.',
          'Попробуйте обновить страницу чуть позже.'
        ]
      };
    }

    if (desc.includes('TIMED_OUT')) {
      return {
        title: 'Превышено время ожидания',
        subtitle: 'Сервер отвечает слишком долго и соединение было прервано.',
        danger: false,
        tips: [
          'Возможно, сайт временно перегружен или недоступен.',
          'Проверьте стабильность интернет-соединения и настройки прокси/VPN.'
        ]
      };
    }

    if (desc.includes('CERT_') || desc.includes('SSL_')) {
      return {
        title: 'Проблема с защищённым соединением',
        subtitle: 'Не удалось проверить сертификат безопасности этого сайта.',
        danger: true,
        tips: [
          'Проверьте правильность системной даты и времени в Windows.',
          'Срок действия сертификата на сайте мог истечь.',
          'Если вы в публичной Wi-Fi сети, возможно, требуется авторизация на её стартовой странице.'
        ]
      };
    }

    if (desc.includes('CONNECTION_RESET') || desc.includes('CONNECTION_CLOSED') || desc.includes('EMPTY_RESPONSE')) {
      return {
        title: 'Соединение было прервано',
        subtitle: 'Сервер неожиданно разорвал передачу данных.',
        danger: false,
        tips: [
          'Попробуйте повторить загрузку страницы.',
          'Проверьте, не блокирует ли соединение антивирус, брандмауэр или VPN.'
        ]
      };
    }

    if (desc.includes('TOO_MANY_REDIRECTS')) {
      return {
        title: 'Слишком много перенаправлений',
        subtitle: 'Страница циклически перенаправляет сама на себя.',
        danger: false,
        tips: [
          'Попробуйте открыть главную страницу сайта вместо вложенной ссылки.',
          'Возможно, проблема на стороне сервера — повторите попытку позже.'
        ]
      };
    }

    return {
      title: 'Не удалось открыть страницу',
      subtitle: 'Во время загрузки произошла ошибка.',
      danger: false,
      tips: [
        'Проверьте интернет-соединение и корректность адреса.',
        'Нажмите «Повторить попытку» или откройте страницу чуть позже.'
      ]
    };
  }

  function isSafeRetryUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  // Действия предупреждений («Только HTTPS», сертификат) уходят в main через переход на browser://error?action=...
  // (main выполняет их только пока вкладка реально показывает предупреждение и берёт адрес из своего состояния)
  function sendHttpsAction(action) {
    window.location.href = `browser://error?action=${action}`;
  }

  const info = resolveErrorInfo(rawDesc);
  document.title = info.title;
  titleEl.textContent = info.title;
  subtitleEl.textContent = info.subtitle;

  if (info.danger) {
    badgeEl.classList.add('danger');
  }

  if (rawUrl) {
    urlEl.textContent = rawUrl;
  } else {
    urlEl.hidden = true;
  }

  for (const tip of info.tips) {
    const li = document.createElement('li');
    li.textContent = tip;
    tipsEl.append(li);
  }

  codeEl.textContent = rawCode ? `${rawDesc} (${rawCode})` : rawDesc;

  if (window.history.length <= 1) {
    backBtn.disabled = true;
  }

  if (isHttpsOnly) {
    retryBtn.hidden = true;
    backBtn.hidden = true;
    httpsBackBtn.hidden = false;
    httpsProceedBtn.hidden = false;
    httpsBackBtn.addEventListener('click', () => sendHttpsAction('https-back'));
    httpsProceedBtn.addEventListener('click', () => sendHttpsAction('https-proceed'));
    httpsBackBtn.focus(); // безопасное действие по умолчанию: случайный Enter не откроет небезопасную страницу
  }

  if (isCert) {
    retryBtn.hidden = true;
    backBtn.hidden = true;
    certBackBtn.hidden = false;
    certBackBtn.addEventListener('click', () => sendHttpsAction('cert-back'));
    if (isLocalCert) {
      certProceedBtn.hidden = false;
      certProceedBtn.addEventListener('click', () => sendHttpsAction('cert-proceed'));
      if (rawFingerprint) {
        certFpEl.textContent = `Отпечаток сертификата: ${rawFingerprint}`;
        certFpEl.hidden = false;
      }
    }
    certBackBtn.focus(); // безопасное действие по умолчанию: случайный Enter не примет сертификат
  }

  function retry() {
    if (isSafeRetryUrl(rawUrl)) {
      window.location.replace(rawUrl);
    } else {
      window.location.reload();
    }
  }

  retryBtn.addEventListener('click', retry);
  backBtn.addEventListener('click', () => window.history.back());

  window.addEventListener('keydown', (e) => {
    if (!isHttpsOnly && !isCert && e.key === 'Enter' && document.activeElement === document.body) {
      retry();
    }
  });
})();
