// The apps a TV or a speaker most often plays from, each with its logo and
// a few of its colors, for the card of what is playing to show which app
// it is when it has no cover art. Where each logo comes from, and under
// which license, is in apps/CREDITS.md.
const LOGOS = import.meta.glob<string>('./apps/*.{svg,png}', { query: '?inline', import: 'default', eager: true })

export type App = {
  name: string
  // Data URLs of the logo as it reads on a light card and on a dark one.
  logo: { light: string; dark: string; mono?: boolean }
  // Three of its colors, for the light behind the card.
  colors: [string, string, string]
}

type Known = {
  name: string
  file: string
  colors: [string, string, string]
  // Drawn in a single color, made black on a light card and white on a
  // dark one.
  mono?: boolean
  // Another file for a dark card, or for a light one, for a logo with
  // dark or pale parts that would not read there.
  dark?: string
  light?: string
  // Other names a player may give it.
  names?: string[]
  // Words found in the ids of its packages, like netflix in com.netflix.ninja.
  packages: string[]
}

// Earlier apps win, so one whose packages hold another's words, like
// YouTube Music's, comes before it.
const KNOWN: Known[] = [
  { name: 'YouTube TV', file: 'youtube-tv.svg', colors: ['#ff0033', '#ff6b5e', '#b3001b'], packages: ['unplugged'] },
  {
    name: 'YouTube Music',
    file: 'youtube-music.svg',
    colors: ['#ff0000', '#ff4f8b', '#8c0d2f'],
    packages: ['youtube.tvmusic', 'youtube.music'],
  },
  { name: 'YouTube', file: 'youtube.svg', colors: ['#ff0000', '#ff5a4e', '#b3001b'], packages: ['youtube'] },
  { name: 'Netflix', file: 'netflix.svg', colors: ['#e50914', '#b1060f', '#ff6b3d'], packages: ['netflix'] },
  { name: 'Spotify', file: 'spotify.svg', colors: ['#1ed760', '#159c46', '#7ce8a6'], packages: ['spotify'] },
  {
    name: 'Prime Video',
    file: 'prime-video.svg',
    dark: 'prime-video-dark.svg',
    colors: ['#00a8e1', '#1a6fd1', '#7fd6f5'],
    names: ['Amazon Prime Video'],
    packages: ['amazonvideo', 'avod', 'primevideo'],
  },
  {
    name: 'Disney+',
    file: 'disney-plus.svg',
    dark: 'disney-plus-dark.svg',
    colors: ['#0f1eff', '#01147c', '#00e5ff'],
    packages: ['disney'],
  },
  {
    name: 'HBO Max',
    file: 'hbo-max.svg',
    colors: ['#002be7', '#7b2ff7', '#00c4ff'],
    mono: true,
    names: ['Max'],
    packages: ['hbo', 'wbd.stream', 'wbd.max'],
  },
  {
    name: 'Movistar Plus+',
    file: 'movistar.svg',
    colors: ['#019df4', '#0b5fbf', '#5bc8ff'],
    names: ['Movistar+', 'Movistar'],
    packages: ['yomvi', 'movistar'],
  },
  {
    name: 'DAZN',
    file: 'dazn.svg',
    colors: ['#e8f000', '#8f9400', '#5a5a5a'],
    mono: true,
    packages: ['dazn'],
  },
  { name: 'Filmin', file: 'filmin.png', colors: ['#43e8a2', '#13b07a', '#8ff5c9'], packages: ['filmin'] },
  {
    name: 'SkyShowtime',
    file: 'skyshowtime.svg',
    colors: ['#6a1fd6', '#e0287b', '#2a7fff'],
    mono: true,
    packages: ['skyshowtime'],
  },
  {
    name: 'Rakuten TV',
    file: 'rakuten.svg',
    colors: ['#bf0000', '#ff3b3b', '#7a0000'],
    names: ['Rakuten'],
    packages: ['wuaki', 'rakuten'],
  },
  {
    name: 'RTVE Play',
    file: 'rtve-play.svg',
    light: 'rtve-play-light.svg',
    colors: ['#f5a717', '#e6511f', '#ff7a3d'],
    names: ['RTVE'],
    packages: ['rtve'],
  },
  {
    name: 'Atresplayer',
    file: 'atresplayer.svg',
    dark: 'atresplayer-dark.svg',
    colors: ['#ff104f', '#ff6a3d', '#b0003a'],
    packages: ['atresplayer', 'atresmedia', 'a3.sgt'],
  },
  {
    name: 'Mediaset Infinity',
    file: 'mediaset-infinity.svg',
    dark: 'mediaset-infinity-dark.svg',
    colors: ['#2a40ff', '#00b3ff', '#8a2bff'],
    names: ['Infinity'],
    packages: ['videomediaset', 'infinitytv'],
  },
  {
    name: 'Mitele',
    file: 'mitele.svg',
    dark: 'mitele-dark.svg',
    colors: ['#ff9b00', '#ea3685', '#9666d4'],
    packages: ['mitele', 'mediaset'],
  },
  { name: '3Cat', file: '3cat.svg', colors: ['#e3173e', '#ff5c5c', '#9b0f2b'], packages: ['3cat', 'ccma'] },
  {
    name: 'Pluto TV',
    file: 'pluto-tv.svg',
    colors: ['#fff200', '#ffb800', '#5d5dff'],
    mono: true,
    packages: ['pluto'],
  },
  { name: 'Twitch', file: 'twitch.svg', colors: ['#9146ff', '#5c16c5', '#c8a6ff'], packages: ['twitch'] },
  { name: 'Plexamp', file: 'plexamp.svg', colors: ['#eaca32', '#d5a02c', '#c57f27'], packages: ['plexamp'] },
  { name: 'Plex', file: 'plex.svg', colors: ['#ebaf00', '#e57d00', '#ffd863'], packages: ['plexapp'] },
  {
    name: 'Crunchyroll',
    file: 'crunchyroll.svg',
    colors: ['#ff5e00', '#ff9a4d', '#d33f00'],
    packages: ['crunchyroll'],
  },
  {
    name: 'Paramount+',
    file: 'paramount-plus.svg',
    colors: ['#0064ff', '#00a3ff', '#1a2fbf'],
    packages: ['cbs.ott', 'paramount'],
  },
  { name: 'Tubi', file: 'tubi.svg', colors: ['#7408ff', '#a259ff', '#3d00a8'], packages: ['tubitv'] },
  {
    name: 'Amazon Music',
    file: 'amazon-music.svg',
    colors: ['#34d1d9', '#1e88e5', '#7b61ff'],
    packages: ['amazon.music', 'amazonmp3'],
  },
  { name: 'Deezer', file: 'deezer.svg', colors: ['#a238ff', '#ff5ca8', '#5b2cff'], packages: ['deezer'] },
  {
    name: 'TIDAL',
    file: 'tidal.svg',
    colors: ['#4dd9e8', '#3b6cff', '#9aa4b5'],
    mono: true,
    packages: ['aspiro', 'tidal'],
  },
  {
    name: 'SoundCloud',
    file: 'soundcloud.svg',
    colors: ['#ff5500', '#ff8800', '#d93a00'],
    mono: true,
    packages: ['soundcloud'],
  },
  { name: 'MUBI', file: 'mubi.svg', colors: ['#3d5afe', '#ff3d71', '#6b7cff'], mono: true, packages: ['mubi'] },
  { name: 'Vimeo', file: 'vimeo.svg', colors: ['#1ab7ea', '#0e7fbf', '#7ee0ff'], packages: ['vimeo'] },
  { name: 'Kodi', file: 'kodi.svg', colors: ['#17b2e7', '#0e7fb0', '#6fd3f5'], packages: ['xbmc', 'kodi'] },
  {
    name: 'VLC',
    file: 'vlc.svg',
    colors: ['#ff8800', '#ffb347', '#d65f00'],
    names: ['VLC media player'],
    packages: ['videolan'],
  },
  { name: 'Jellyfin', file: 'jellyfin.svg', colors: ['#aa5cc3', '#00a4dc', '#6b7cff'], packages: ['jellyfin'] },
  { name: 'Emby', file: 'emby.svg', colors: ['#52b54b', '#2e8b3a', '#9be08f'], packages: ['emby'] },
  { name: 'Stremio', file: 'stremio.svg', colors: ['#685cee', '#8a5cf5', '#3f37b3'], packages: ['stremio'] },
  {
    name: 'Pocket Casts',
    file: 'pocket-casts.svg',
    colors: ['#f43e37', '#ff7a59', '#b3201b'],
    packages: ['shiftyjelly', 'pocketcasts'],
  },
  { name: 'Audible', file: 'audible.svg', colors: ['#f8991c', '#ffbe5c', '#d4700a'], packages: ['audible'] },
  {
    name: 'iHeartRadio',
    file: 'iheartradio.svg',
    colors: ['#c6002b', '#ff3b5c', '#7a001a'],
    packages: ['clearchannel', 'iheart'],
  },
  { name: 'Hulu', file: 'hulu.svg', colors: ['#1ce783', '#0fa968', '#7df5bd'], packages: ['hulu'] },
  {
    name: 'Peacock',
    file: 'peacock.svg',
    dark: 'peacock-dark.svg',
    colors: ['#fccc12', '#069de0', '#6e55dc'],
    packages: ['peacock'],
  },
  {
    name: 'Sling TV',
    file: 'sling-tv.svg',
    colors: ['#0f6cd8', '#25a2ff', '#ff7a00'],
    names: ['Sling'],
    packages: ['com.sling'],
  },
  { name: 'Fubo', file: 'fubo.svg', colors: ['#fa4616', '#ff8a5c', '#c83d1e'], names: ['fuboTV'], packages: ['fubo'] },
  {
    name: 'Philo',
    file: 'philo.svg',
    dark: 'philo-dark.svg',
    colors: ['#5b3cf5', '#a07bff', '#2b1a9e'],
    packages: ['com.philo'],
  },
  {
    name: 'Starz',
    file: 'starz.svg',
    colors: ['#3a8f9c', '#1d5a63', '#7cc4cf'],
    mono: true,
    names: ['STARZ'],
    packages: ['starz'],
  },
  {
    name: 'MGM+',
    file: 'mgm-plus.svg',
    colors: ['#c9a24b', '#8a6a26', '#e8cd8a'],
    names: ['MGM Plus', 'Epix'],
    packages: ['epix', 'mgmplus'],
  },
  { name: 'BritBox', file: 'britbox.svg', colors: ['#1e4fbf', '#4a7dff', '#e8364f'], packages: ['britbox'] },
  {
    name: 'The Roku Channel',
    file: 'roku-channel.svg',
    colors: ['#662d91', '#9b59d0', '#3d1a5c'],
    mono: true,
    names: ['Roku Channel'],
    packages: ['roku.web.trc', 'roku.trc'],
  },
  { name: 'Pandora', file: 'pandora.svg', colors: ['#224099', '#3668ff', '#00a0ee'], packages: ['pandora'] },
  {
    name: 'SiriusXM',
    file: 'siriusxm.svg',
    colors: ['#0000eb', '#3b7bff', '#7a5cff'],
    names: ['Sirius XM'],
    mono: true,
    packages: ['sirius'],
  },
  {
    name: 'CuriosityStream',
    file: 'curiositystream.svg',
    light: 'curiositystream-light.svg',
    colors: ['#f5a300', '#ffcd57', '#b87700'],
    names: ['Curiosity Stream'],
    packages: ['curiosity'],
  },
  { name: 'Nebula', file: 'nebula.svg', colors: ['#2cadfe', '#6bc8ff', '#1a6fd1'], packages: ['standard.nebula'] },
  {
    name: 'Dailymotion',
    file: 'dailymotion.svg',
    colors: ['#0d65ff', '#00aaff', '#6b4cff'],
    mono: true,
    packages: ['dailymotion'],
  },
  { name: 'Kick', file: 'kick.svg', colors: ['#53fc18', '#2fbf00', '#a6ff7f'], packages: ['com.kick.'] },
  {
    name: 'Fandango at Home',
    file: 'fandango-at-home.svg',
    colors: ['#ff7300', '#ffa64d', '#3d5afe'],
    names: ['Vudu'],
    packages: ['vudu'],
  },
  { name: 'ESPN', file: 'espn.svg', colors: ['#e52534', '#ff5c66', '#a50f1b'], packages: ['espn'] },
  {
    name: 'Xumo Play',
    file: 'xumo.svg',
    dark: 'xumo-dark.svg',
    colors: ['#7b2ff7', '#c13cff', '#3d1aa8'],
    names: ['Xumo'],
    packages: ['xumo'],
  },
  {
    name: 'Acorn TV',
    file: 'acorn-tv.svg',
    light: 'acorn-tv-light.svg',
    colors: ['#00a651', '#5cd18b', '#006b35'],
    packages: ['acorn.tv'],
  },
  {
    name: 'The Criterion Channel',
    file: 'criterion.svg',
    colors: ['#c8a24a', '#8c8c8c', '#3a6ea5'],
    names: ['Criterion Channel'],
    packages: ['criterion'],
  },
  {
    name: 'Hoopla',
    file: 'hoopla.svg',
    colors: ['#2a8ee5', '#5bb6ff', '#ef5a28'],
    mono: true,
    names: ['hoopla'],
    packages: ['hoopla'],
  },
  { name: 'F1 TV', file: 'f1-tv.svg', colors: ['#e10600', '#ff4d47', '#8f0400'], packages: ['formulaone'] },
  {
    name: 'Red Bull TV',
    file: 'red-bull-tv.svg',
    colors: ['#db0a40', '#ffcc00', '#1e2a78'],
    packages: ['rbtv', 'nousguide'],
  },
  {
    name: 'BBC iPlayer',
    file: 'bbc-iplayer.svg',
    colors: ['#ff4c98', '#a31cf0', '#ff8a3d'],
    names: ['iPlayer'],
    packages: ['iplayer'],
  },
  { name: 'BBC Sounds', file: 'bbc-sounds.svg', colors: ['#ff6400', '#ff9a3d', '#d63a00'], packages: ['bbc.sounds'] },
  {
    name: 'ITVX',
    file: 'itvx.svg',
    colors: ['#deeb52', '#3ad6c5', '#7a4cff'],
    names: ['ITV Hub', 'ITV'],
    packages: ['itvmobileplayer', 'itvx'],
  },
  {
    name: 'Channel 4',
    file: 'channel-4.svg',
    colors: ['#aaff89', '#4ad9a0', '#2f8f6b'],
    names: ['All 4'],
    packages: ['channel4'],
  },
  {
    name: 'NOW',
    file: 'now.svg',
    dark: 'now-dark.svg',
    colors: ['#00c79d', '#24e0b8', '#0a8f73'],
    names: ['NOW TV'],
    packages: ['nowtv'],
  },
  { name: 'Sky Go', file: 'sky-go.svg', colors: ['#e50766', '#ef7d06', '#1493d2'], packages: ['skygo'] },
  {
    name: 'TuneIn',
    file: 'tunein.svg',
    colors: ['#14d8cc', '#1c203c', '#5ce6dd'],
    mono: true,
    names: ['TuneIn Radio'],
    packages: ['tunein'],
  },
  {
    name: 'Canal+',
    file: 'canal-plus.svg',
    colors: ['#3c78d8', '#9b59d0', '#e2445c'],
    names: ['CANAL+', 'myCANAL'],
    packages: ['canal'],
  },
  {
    name: 'france.tv',
    file: 'france-tv.svg',
    colors: ['#2b3cff', '#6a4cff', '#ff3d55'],
    names: ['France TV'],
    packages: ['francetv', 'pluzz'],
  },
  {
    name: 'TF1+',
    file: 'tf1-plus.svg',
    colors: ['#0b3bff', '#ff2d3b', '#5c7cff'],
    mono: true,
    names: ['TF1', 'MYTF1'],
    packages: ['tf1'],
  },
  {
    name: 'M6+',
    file: 'm6-plus.svg',
    dark: 'm6-plus-dark.svg',
    colors: ['#ff2d55', '#ff8a00', '#7a2bff'],
    names: ['6play', 'M6'],
    packages: ['m6replay', 'fr.m6'],
  },
  {
    name: 'Molotov',
    file: 'molotov.svg',
    light: 'molotov-light.svg',
    colors: ['#ff3e32', '#ff8a5c', '#b5160d'],
    names: ['Molotov TV'],
    packages: ['molotov'],
  },
  { name: 'ARTE', file: 'arte.svg', colors: ['#fa481c', '#ff8a5c', '#b32c08'], names: ['Arte'], packages: ['tv.arte'] },
  {
    name: 'Joyn',
    file: 'joyn.svg',
    colors: ['#e6007e', '#ff5ab0', '#5a2bff'],
    mono: true,
    packages: ['joyn', 'prosiebensat1digital'],
  },
  {
    name: 'RTL+',
    file: 'rtl-plus.svg',
    colors: ['#fa002e', '#ff7a00', '#2b6bff'],
    names: ['RTL Plus', 'TVNOW'],
    packages: ['tvnow', 'rtlplus'],
  },
  {
    name: 'ARD Mediathek',
    file: 'ard-mediathek.svg',
    dark: 'ard-mediathek-dark.svg',
    colors: ['#00418c', '#2f7de1', '#7fb2ff'],
    names: ['ARD'],
    packages: ['swr.avp.ard', 'ardmediathek'],
  },
  {
    name: 'ZDF',
    file: 'zdf.svg',
    colors: ['#fa7d19', '#ffb066', '#c45500'],
    names: ['ZDFmediathek'],
    packages: ['zdf'],
  },
  {
    name: 'waipu.tv',
    file: 'waipu-tv.svg',
    dark: 'waipu-tv-dark.svg',
    colors: ['#e0004d', '#ff5a8a', '#7a0029'],
    names: ['waipu'],
    packages: ['waipu', 'exaring'],
  },
  {
    name: 'Zattoo',
    file: 'zattoo.svg',
    dark: 'zattoo-dark.svg',
    colors: ['#f39200', '#ffbf4d', '#b86b00'],
    packages: ['zattoo'],
  },
  {
    name: 'MagentaTV',
    file: 'magenta-tv.svg',
    colors: ['#e20074', '#ff5ab0', '#8f0049'],
    names: ['Magenta TV'],
    packages: ['magentatv'],
  },
  { name: 'RaiPlay', file: 'raiplay.svg', colors: ['#0a6ae6', '#3ab0ff', '#063d8c'], packages: ['rainet', 'raiplay'] },
  {
    name: 'TIMvision',
    file: 'timvision.svg',
    dark: 'timvision-dark.svg',
    colors: ['#0033a1', '#e2001a', '#3d7bff'],
    packages: ['timvision', 'cubovision'],
  },
  {
    name: 'NPO Start',
    file: 'npo-start.svg',
    colors: ['#ff6d00', '#ffa24d', '#c44d00'],
    names: ['NPO'],
    packages: ['uitzendinggemist', 'nl.npo'],
  },
  { name: 'VTM GO', file: 'vtm-go.svg', colors: ['#ff004c', '#ff6a8a', '#a3002f'], packages: ['vmma', 'vtmgo'] },
  { name: 'Viaplay', file: 'viaplay.svg', colors: ['#fe365f', '#ff7a5c', '#c4004b'], packages: ['viaplay'] },
  {
    name: 'SVT Play',
    file: 'svt-play.svg',
    dark: 'svt-play-dark.svg',
    colors: ['#22b14c', '#5cd17e', '#127a32'],
    packages: ['svtplay'],
  },
  {
    name: 'NRK TV',
    file: 'nrk-tv.svg',
    dark: 'nrk-tv-dark.svg',
    colors: ['#073b84', '#3a7bd5', '#e2231a'],
    names: ['NRK'],
    packages: ['nrk'],
  },
  {
    name: 'TV 2 Play',
    file: 'tv2-play.svg',
    dark: 'tv2-play-dark.svg',
    colors: ['#6704ff', '#a35cff', '#3a0099'],
    names: ['TV2 Play'],
    packages: ['no.tv2', 'dk.tv2'],
  },
  {
    name: 'DRTV',
    file: 'drtv.svg',
    colors: ['#c8102e', '#ff5a6e', '#7a0a1c'],
    names: ['DR TV'],
    packages: ['dr.tvplayer'],
  },
  {
    name: 'Yle Areena',
    file: 'yle-areena.svg',
    dark: 'yle-areena-dark.svg',
    colors: ['#00b4c4', '#5ce1ea', '#007a85'],
    names: ['Areena'],
    packages: ['yle.webtv', 'areena'],
  },
  { name: 'TV4 Play', file: 'tv4-play.svg', colors: ['#e0001c', '#ff5a6a', '#8f0012'], packages: ['tv4'] },
  { name: 'RTP Play', file: 'rtp-play.svg', colors: ['#0f7dc2', '#2bb5ff', '#e2001a'], packages: ['rtp.play'] },
  { name: 'Globoplay', file: 'globoplay.svg', colors: ['#ff1e3c', '#ff6a3d', '#b3001b'], packages: ['globo'] },
  { name: 'ViX', file: 'vix.svg', colors: ['#ff5a00', '#ff9a3d', '#c43c00'], names: ['Vix'], packages: ['prendetv'] },
  {
    name: 'Claro video',
    file: 'claro-video.svg',
    dark: 'claro-video-dark.svg',
    colors: ['#e2231a', '#ff6a5c', '#8f0f0a'],
    names: ['Claro Video'],
    packages: ['clarovideo', 'com.dla.android'],
  },
  { name: 'ZEE5', file: 'zee5.svg', colors: ['#8230c6', '#d23cff', '#4a1580'], packages: ['graymatrix', 'zee5'] },
  {
    name: 'JioSaavn',
    file: 'jiosaavn.svg',
    dark: 'jiosaavn-dark.svg',
    colors: ['#2bc5b4', '#1d8f83', '#7fe3d8'],
    names: ['Saavn'],
    packages: ['jiobeats', 'saavn'],
  },
  { name: 'Gaana', file: 'gaana.svg', colors: ['#e72c30', '#ff6b4a', '#a3151a'], packages: ['gaana'] },
  {
    name: 'MX Player',
    file: 'mx-player.svg',
    dark: 'mx-player-dark.svg',
    colors: ['#0d8bf0', '#3fb4ff', '#0a5bb0'],
    packages: ['mxtech'],
  },
  { name: 'iQIYI', file: 'iqiyi.svg', colors: ['#00cc36', '#5ce67f', '#008f26'], packages: ['iqiyi'] },
  {
    name: 'Viki',
    file: 'viki.svg',
    colors: ['#1ba1e2', '#00d1ff', '#0b6ea8'],
    names: ['Rakuten Viki'],
    packages: ['viki'],
  },
  {
    name: 'WeTV',
    file: 'wetv.svg',
    colors: ['#ff6a00', '#ffa04d', '#ff2d55'],
    mono: true,
    packages: ['qqlivei18n', 'wetv'],
  },
  { name: 'Viu', file: 'viu.svg', colors: ['#f5b800', '#ffd75c', '#b88a00'], packages: ['vuclip'] },
  {
    name: 'ABEMA',
    file: 'abema.svg',
    colors: ['#3ab54a', '#7fd88a', '#1f7a2b'],
    names: ['AbemaTV'],
    packages: ['abema'],
  },
  { name: 'TVer', file: 'tver.svg', colors: ['#1c97e8', '#5cc0ff', '#0a5fa3'], packages: ['hamitv'] },
  {
    name: 'U-NEXT',
    file: 'u-next.svg',
    colors: ['#00a0e9', '#4cc4ff', '#1a4fd1'],
    mono: true,
    names: ['UNEXT'],
    packages: ['unext'],
  },
  {
    name: 'TVING',
    file: 'tving.svg',
    colors: ['#ff153c', '#ff6a7f', '#a3001f'],
    names: ['Tving'],
    packages: ['tving'],
  },
  {
    name: 'bilibili',
    file: 'bilibili.svg',
    colors: ['#00a1d6', '#fb7299', '#5cc8f0'],
    names: ['Bilibili'],
    packages: ['bilibili', 'danmaku'],
  },
  { name: 'KKBOX', file: 'kkbox.svg', colors: ['#09cef6', '#5ce1ff', '#0a8fb0'], packages: ['kkbox'] },
  { name: 'Stan', file: 'stan.svg', colors: ['#0072fb', '#4ca3ff', '#00419c'], packages: ['au.com.stan'] },
  {
    name: 'Binge',
    file: 'binge.svg',
    colors: ['#ff4b4b', '#ff8a5c', '#8a2bff'],
    names: ['BINGE'],
    packages: ['streamotion.ares'],
  },
  {
    name: 'Crave',
    file: 'crave.svg',
    colors: ['#0072ce', '#2bb5ff', '#00478a'],
    names: ['CraveTV'],
    packages: ['cravetv'],
  },
  {
    name: 'CBC Gem',
    file: 'cbc-gem.svg',
    dark: 'cbc-gem-dark.svg',
    colors: ['#e60505', '#ff5a5a', '#8f0303'],
    packages: ['cbctv'],
  },
  {
    name: 'Qobuz',
    file: 'qobuz.svg',
    dark: 'qobuz-dark.svg',
    colors: ['#0070ef', '#4ca3ff', '#00419c'],
    packages: ['qobuz'],
  },
  {
    name: 'Napster',
    file: 'napster.svg',
    colors: ['#2259ff', '#00c2ff', '#7a3cff'],
    names: ['Rhapsody'],
    packages: ['rhapsody', 'napster'],
  },
  { name: 'Anghami', file: 'anghami.svg', colors: ['#a228e0', '#e04cff', '#5c13a3'], packages: ['anghami'] },
  { name: 'Audiomack', file: 'audiomack.svg', colors: ['#ffa200', '#ffc94d', '#ff6a00'], packages: ['audiomack'] },
  { name: 'Bandcamp', file: 'bandcamp.svg', colors: ['#1da0c3', '#629aa9', '#5ce1ff'], packages: ['bandcamp'] },
  { name: 'Mixcloud', file: 'mixcloud.svg', colors: ['#5000ff', '#8a5cff', '#2b0099'], packages: ['mixcloud'] },
  {
    name: 'Boomplay',
    file: 'boomplay.svg',
    colors: ['#05e5ff', '#2b6bff', '#7a3cff'],
    mono: true,
    packages: ['boomplay'],
  },
  {
    name: 'Yandex Music',
    file: 'yandex-music.svg',
    colors: ['#ffbc0d', '#ff5a00', '#ff2d55'],
    packages: ['yandex.music'],
  },
  { name: 'Castbox', file: 'castbox.svg', colors: ['#f55b23', '#ff9a5c', '#b33a0d'], packages: ['castbox'] },
  {
    name: 'Podcast Addict',
    file: 'podcast-addict.svg',
    colors: ['#f4842d', '#ffb066', '#b85a12'],
    packages: ['podcastaddict'],
  },
  { name: 'Player FM', file: 'player-fm.svg', colors: ['#c8122a', '#ff5a6a', '#8a0c1d'], packages: ['fm.player'] },
  { name: 'Orange TV', file: 'orange-tv.svg', colors: ['#ff7900', '#ffa64d', '#c45500'], packages: ['orangetv'] },
  {
    name: 'Vodafone TV',
    file: 'vodafone-tv.svg',
    colors: ['#e60000', '#ff5a5a', '#990000'],
    packages: ['vodafone.tv', 'vodafonetv'],
  },
  {
    name: 'Eurosport',
    file: 'eurosport.svg',
    dark: 'eurosport-dark.svg',
    colors: ['#141b4d', '#2b3cff', '#00b4ff'],
    packages: ['eurosport'],
  },
  { name: 'Shahid', file: 'shahid.svg', colors: ['#00d27a', '#5ce6a6', '#00905a'], mono: true, packages: ['shahid'] },
]

// An app's package id, words joined by dots with no spaces.
export const PACKAGE = /^[\w-]+(\.[\w-]+)+$/

const plain = (name: string) =>
  name
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]/g, '')

// The app a player names, by its name or by the id of its package, if it is
// one of the known ones.
export function appOf(...said: unknown[]): App | null {
  for (const value of said) {
    if (typeof value !== 'string' || !value) continue
    const id = value.toLowerCase()
    const known = PACKAGE.test(value)
      ? KNOWN.find(app => app.packages.some(word => id.includes(word)))
      : KNOWN.find(app => [app.name, ...(app.names ?? [])].some(name => plain(name) === plain(value)))
    if (!known) continue
    const logo = (file?: string) => LOGOS[`./apps/${file ?? known.file}`]
    return {
      name: known.name,
      logo: { light: logo(known.light), dark: logo(known.dark), mono: known.mono },
      colors: known.colors,
    }
  }
  return null
}
