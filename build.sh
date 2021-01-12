# build ytdl.
mkdir -p bin
curl -L https://yt-dl.org/downloads/latest/youtube-dl -o ./bin/ytdl 2> /dev/null
chmod a+rx ./bin/ytdl