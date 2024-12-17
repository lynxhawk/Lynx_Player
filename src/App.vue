<template>
  <div class="container">
    <div class="player">
      <div class="visualizer-controls">
        <button @click="toggleVisualizerType">
          <span class="mdi mdi-autorenew"></span>
        </button>
      </div>

      <canvas id="visualizer"></canvas>
      <div class="control_list">
        <!-- 播放进度条 -->
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          v-model="progress"
          @input="seekTrack"
          @change="seekTrack"
          class="progress-bar"
        />

        <div class="controls">
          <!-- 上一首按钮 -->
          <button @click="prevTrack">
            <span class="mdi mdi-skip-previous"></span>
          </button>
          <!-- 播放/暂停按钮 -->
          <button @click="togglePlay">
            <span :class="isPlaying ? 'mdi mdi-pause' : 'mdi mdi-play'"></span>
          </button>
          <!-- 下一首按钮 -->
          <button @click="nextTrack">
            <span class="mdi mdi-skip-next"></span>
          </button>
          <!-- 循环模式按钮 -->
          <button @click="toggleLoopMode">
            <span v-if="currentLoopMode === 0" class="mdi mdi-repeat"></span>
            <span
              v-else-if="currentLoopMode === 1"
              class="mdi mdi-shuffle"
            ></span>
            <span v-else class="mdi mdi-repeat-variant"></span>
          </button>
          <!-- 选择文件按钮 -->
          <label class="custom-file-upload">
            <input
              type="file"
              accept="audio/*"
              multiple
              @change="handleFileUpload"
            />
            <span class="mdi mdi-folder-music"></span>
          </label>
        </div>

        <div class="playlist-title">
          <span class="mdi mdi-playlist-music"></span>
          <h3>播放列表</h3>
        </div>

        <div class="playlist" @scroll="disableAutoScroll">
          <ul>
            <li
              v-for="(track, index) in tracks"
              :key="index"
              :class="{ playing: index === currentTrackIndex }"
              @click="playSpecificTrack(index)"
            >
              {{ track.name }}
              <span
                @click.stop="removeTrack(index)"
                class="mdi mdi-trash-can-outline"
              ></span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
  <!-- 音频播放元素 -->
  <audio
    ref="audioElement"
    @timeupdate="updateProgressDisplay"
    @ended="onTrackEnd"
    @loadedmetadata="initializeAudio"
  ></audio>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, onMounted, watch } from "vue";

const DB_NAME = "MusicPlayerDB";
const STORE_NAME = "Tracks";
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
};

const addTrackToDB = (track: { name: string; file: File }) => {
  if (!db) return;
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  store.add(track);
};

const getTracksFromDB = (): Promise<
  { id: number; name: string; file: File }[]
> => {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve([]);
      return;
    }

    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as { id: number; name: string; file: File }[]);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
};

const deleteTrackFromDB = (id: number) => {
  if (!db) return;
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  store.delete(id);
};

export default defineComponent({
  name: "App",
  setup() {
    const audioElement = ref<HTMLAudioElement | null>(null);
    const audioContext = ref<AudioContext | null>(null);
    const analyser = ref<AnalyserNode | null>(null);
    const audioSource = ref<MediaElementAudioSourceNode | null>(null);
    const isPlaying = ref(false);
    const currentTrackIndex = ref(0);
    const tracks = reactive<{ id: number; name: string; file: File }[]>([]);
    const dataArray = ref<Uint8Array | null>(null);
    const loopModes = ["顺序循环", "随机播放", "单曲循环"];
    const currentLoopMode = ref(0);
    const progress = ref(0);
    let trackDuration = 0;
    const visualizerType = ref<"circle" | "tree">("circle"); // 当前可视化类型

    let autoScrollEnabled = true; // 标志位：控制是否自动滚动

    const scrollToCurrentTrack = () => {
      if (!autoScrollEnabled) return; // 如果用户手动滚动，不自动滚动

      const playlist = document.querySelector(".playlist");
      const currentTrack = document.querySelector(".playlist li.playing");

      if (playlist && currentTrack) {
        currentTrack.scrollIntoView({
          behavior: "smooth", // 平滑滚动
          //block: "nearest", // 只滚动到当前元素可见即可
          block: "center", // 将元素滚动到列表的中间
          inline: "nearest", // 如果水平方向不需要滚动，就忽略
        });
      }
    };

    const disableAutoScroll = () => {
      autoScrollEnabled = false;

      // 用户停止滚动 3 秒后恢复自动滚动功能
      clearTimeout((window as any).scrollTimeout);
      (window as any).scrollTimeout = setTimeout(() => {
        autoScrollEnabled = true;
      }, 1000);
    };

    const toggleVisualizerType = () => {
      visualizerType.value =
        visualizerType.value === "circle" ? "tree" : "circle";
    };

    const initializeAudio = () => {
      if (!audioContext.value) {
        audioContext.value = new (window.AudioContext ||
          window.webkitAudioContext)();
        console.log("AudioContext 初始化");
      }

      if (!audioSource.value && audioElement.value) {
        audioSource.value = audioContext.value.createMediaElementSource(
          audioElement.value
        );

        if (!analyser.value) {
          analyser.value = audioContext.value.createAnalyser();
          analyser.value.fftSize = 512;
        }

        audioSource.value.connect(analyser.value);
        analyser.value.connect(audioContext.value.destination);
      }
    };

    const loadTrack = async (index: number) => {
      if (audioElement.value) {
        const track = tracks[index];
        audioElement.value.src = URL.createObjectURL(track.file);
        audioElement.value.load(); // 确保音频资源加载
        console.log("音频加载中...");
        await new Promise((resolve) => {
          audioElement.value?.addEventListener("canplaythrough", resolve, {
            once: true,
          });
        });
        console.log("音频加载完成");
      }
    };
    const handleFileUpload = async (event: Event) => {
      const files = (event.target as HTMLInputElement).files;
      if (files) {
        Array.from(files).forEach((file) => {
          const track = { name: file.name, file };
          addTrackToDB(track);
          tracks.push({ id: Date.now(), name: file.name, file });
        });
      }
    };

    const removeTrack = (index: number) => {
      const track = tracks[index];
      deleteTrackFromDB(track.id);
      tracks.splice(index, 1);
    };

    const updateProgressDisplay = () => {
      if (audioElement.value && !isNaN(audioElement.value.duration)) {
        trackDuration = audioElement.value.duration; // 更新音频总时长
        progress.value = (audioElement.value.currentTime / trackDuration) * 100;
      }
    };

    const seekTrack = () => {
      if (audioElement.value) {
        const seekTime = (progress.value / 100) * trackDuration;
        audioElement.value.currentTime = seekTime;
      }
    };

    // 在播放按钮事件中调用
    const togglePlay = async () => {
      if (!audioElement.value) return;

      try {
        if (!audioContext.value || audioContext.value.state === "suspended") {
          initializeAudio();
          await audioContext.value?.resume();
          console.log("音频上下文已恢复");
        }

        if (audioElement.value.muted) {
          audioElement.value.muted = false; // 取消静音
        }

        if (isPlaying.value) {
          audioElement.value.pause();
          isPlaying.value = false;
          console.log("音频已暂停");
        } else {
          // 等待音频资源加载完成
          if (audioElement.value.readyState < 4) {
            console.log("等待音频资源加载...");
            await new Promise((resolve) => {
              audioElement.value?.addEventListener("canplaythrough", resolve, {
                once: true,
              });
            });
            console.log("音频资源加载完成");
          }

          await audioElement.value.play();
          isPlaying.value = true;
          visualize();
          console.log("音频播放中");
        }
      } catch (error) {
        console.error("播放音频时出错:", error);
      }
    };

    const playSpecificTrack = (index: number) => {
      currentTrackIndex.value = index;
      loadTrack(index);

      if (audioElement.value) {
        audioElement.value.oncanplaythrough = () => {
          audioElement.value?.play();
          isPlaying.value = true;
          visualize();
          scrollToCurrentTrack(); // 播放时自动滚动到当前歌曲
        };
      }
    };

    const toggleLoopMode = () => {
      currentLoopMode.value = (currentLoopMode.value + 1) % loopModes.length;
    };

    const nextTrack = () => {
      const trackCount = tracks.length;
      if (trackCount === 0) return;

      let nextIndex;
      if (currentLoopMode.value === 2) {
        // 随机播放
        nextIndex = Math.floor(Math.random() * trackCount);
      } else {
        nextIndex = (currentTrackIndex.value + 1) % trackCount;
      }

      playSpecificTrack(nextIndex);
    };

    const prevTrack = () => {
      const trackCount = tracks.length;
      if (trackCount === 0) return;

      let prevIndex;
      if (currentLoopMode.value === 2) {
        // 随机播放
        prevIndex = Math.floor(Math.random() * trackCount);
      } else {
        prevIndex = (currentTrackIndex.value - 1 + trackCount) % trackCount;
      }

      playSpecificTrack(prevIndex);
    };

    let trackEnding = false; // 防止重复触发标志

    const onTrackEnd = () => {
      if (trackEnding) return; // 避免重复调用
      trackEnding = true;

      console.log("当前音频播放结束，准备切换到下一首");

      setTimeout(() => {
        switch (currentLoopMode.value) {
          case 0: // 顺序循环
            nextTrack();
            break;
          case 1: // 随机播放
            const randomIndex = Math.floor(Math.random() * tracks.length);
            playSpecificTrack(randomIndex);
            break;
          case 2: // 单曲循环
            if (audioElement.value) {
              audioElement.value.currentTime = 0;
              audioElement.value.play();
            }
            break;
        }
        trackEnding = false; // 恢复标志位
      }, 100); // 加入小延时，确保状态正确
    };

    const visualize = () => {
      const canvas = document.getElementById("visualizer") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d");

      if (!ctx || !analyser.value) return;

      canvas.width = 600;
      canvas.height = 600;

      // 创建默认空数据数组
      const bufferLength = analyser.value
        ? analyser.value.frequencyBinCount
        : 256; // 默认 256 数据
      dataArray.value = new Uint8Array(bufferLength);

      const draw = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (analyser.value) {
          // 如果有音频输入，获取真实数据
          analyser.value.getByteFrequencyData(dataArray.value);
        } else {
          // 如果没有音频输入，填充最小值
          dataArray.value = new Uint8Array(bufferLength).fill(5);
        }

        if (visualizerType.value === "circle") {
          drawCircleVisualizer(ctx, bufferLength);
        } else if (visualizerType.value === "tree") {
          drawTreeVisualizer(ctx, bufferLength);
        }

        requestAnimationFrame(draw);
      };

      const drawCircleVisualizer = (
        ctx: CanvasRenderingContext2D,
        bufferLength: number
      ) => {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = canvas.width / 3;

        // 每个频谱条的角度 取了部分进行延伸
        const totalAngle = Math.PI * 2;
        const segmentAngle = ((totalAngle / bufferLength) * 4) / 3;

        for (let i = 0; i < 192; i++) {
          const value = Math.max(dataArray.value[i], 5);
          const barLength = value / 2;

          const angle = i * segmentAngle;
          const x1 = centerX + Math.cos(angle) * radius;
          const y1 = centerY + Math.sin(angle) * radius;
          const x2 = centerX + Math.cos(angle) * (radius + barLength);
          const y2 = centerY + Math.sin(angle) * (radius + barLength);

          //ctx.strokeStyle = `hsl(${i * 2}, 100%, 50%)`; // 彩色
          // 创建两种颜色的渐变
          const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
          gradient.addColorStop(0, "#cc53ae"); // 第一种颜色
          gradient.addColorStop(1, "#22de9c"); // 第二种颜色

          ctx.strokeStyle = gradient;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      };

      const drawTreeVisualizer = (
        ctx: CanvasRenderingContext2D,
        bufferLength: number
      ) => {
        const totalBars = bufferLength / 2; // 减少柱子的数量（可选）
        const barWidth = (canvas.width / totalBars) * 0.6; // 增加柱子的宽度
        const barSpacing = (canvas.width / totalBars) * 0.4; // 间距为总宽度的40%

        for (let i = 0; i < totalBars; i++) {
          const barHeight = (dataArray.value[i] / 255) * canvas.height * 0.8;

          // 使用 HSL 生成颜色，色相随索引平滑变化，降低亮度
          const hue = (i / totalBars) * 360; // 色相均匀分布 (0-360)
          const saturation = 100; // 饱和度设为 80%
          const lightness = 40; // 亮度设为 40%，避免过于亮眼

          ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;

          // 绘制柱状条，增加间距
          ctx.fillRect(
            i * (barWidth + barSpacing), // x 位置
            canvas.height - barHeight, // y 位置
            barWidth, // 宽度
            barHeight // 高度
          );
        }
      };

      if (isPlaying.value) {
        draw();
      }
    };

    onMounted(async () => {
      await openDB();
      const savedTracks = await getTracksFromDB();
      tracks.push(...savedTracks);

      // 如果播放列表中有歌曲，自动加载第一首
      if (tracks.length > 0 && audioElement.value) {
        loadTrack(0);
        console.log("默认加载第一首歌曲");
      }

      // 初始化可视化
      visualize();

      document.body.addEventListener(
        "click",
        () => {
          if (!audioContext.value) {
            initializeAudio(); // 确保只初始化一次
          }
        },
        { once: true } // 确保事件只执行一次
      );

      if (audioElement.value) {
        audioElement.value.addEventListener(
          "timeupdate",
          updateProgressDisplay
        );
        audioElement.value.addEventListener("ended", onTrackEnd);
      }
    });

    return {
      audioElement,
      handleFileUpload,
      togglePlay,
      toggleLoopMode,
      prevTrack,
      nextTrack,
      removeTrack,
      isPlaying,
      tracks,
      currentTrackIndex,
      loopModes,
      currentLoopMode,
      playSpecificTrack,
      updateProgressDisplay,
      seekTrack,
      progress,
      onTrackEnd,
      initializeAudio,
      toggleVisualizerType,
      disableAutoScroll,
    };
  },
});
</script>

<style scoped>
.container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  width: 100vw;
  background: linear-gradient(to bottom, #372963, #000000);
  color: white;
}

.player {
  text-align: center;
  flex-direction: row;
  display: flex;
  justify-content: center;
  margin: 0 auto;
}

.visualizer-controls button {
  background-color: transparent;
  color: white;
  border: none;
  cursor: pointer;
  font-size: 24px;
}

.visualizer-controls button:hover {
  color: #22de9c;
}

canvas {
  background-color: transparent;
  display: block;
  width: 600px;
  height: 600px;
  margin-right: 100px;
}

.control_list {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.controls {
  margin-top: 30px;
  width: 30%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
}

button span.mdi,
.custom-file-upload span.mdi {
  font-size: 60px; /* 图标大小 */
  vertical-align: middle; /* 垂直居中 */
}

button {
  margin: 0 5px;
  padding: 10px 20px;
  font-size: 16px;
  background-color: transparent;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  width: 100px;
  border: none;
  transition: background 0.3s; /* 平滑过渡 */
}

button:focus {
  outline: none; /* 确保点击聚焦时也没有白边 */
}

button:hover {
  background-color: #b6b6b636;
  color: #22de9c;
}

.custom-file-upload {
  display: inline-flex; /* 使用 flex 布局 */
  justify-content: center; /* 水平居中 */
  align-items: center; /* 垂直居中 */
  padding: 10px 20px;
  font-size: 16px;
  background-color: transparent;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  margin: 0 5px;
  width: 100px;
  transition: background 0.3s; /* 平滑过渡 */
  height: 76px;
}

.custom-file-upload:hover {
  background-color: #b6b6b636;
  color: #22de9c;
}


.custom-file-upload input {
  display: none;
}

.playlist {
  text-align: left;
  width: 600px;
  max-height: 380px;
  overflow-y: auto;
  transition: all 0.3s ease-in-out;
  box-sizing: border-box;
  /* 始终保留滚动条空间 */
  scrollbar-gutter: stable;
}

.playlist-title {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  width: 100%;
  height: 30px;
  margin-top: 30px;
}
.playlist-title h3 {
  margin-left: 10px;
}

.playlist-title span {
  margin-left: 10px;
  font-size: 35px;
}

/* 滚动条基础样式 */
.playlist::-webkit-scrollbar {
  width: 6px; /* 滚动条默认宽度 */
  opacity: 0; /* 初始透明 */
  transition: opacity 0.3s ease-in-out; /* 平滑透明度 */
}

/* 滚动条轨道 */
.playlist::-webkit-scrollbar-track {
  background: transparent; /* 轨道背景透明 */
}

/* 滚动条滑块 */
.playlist::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0); /* 初始完全透明 */
  border-radius: 3px; /* 圆角 */
  transition: background 0.3s ease-in-out; /* 平滑滑块颜色 */
}

/* 鼠标悬停在列表区域时 */
.playlist:hover::-webkit-scrollbar {
  opacity: 1; /* 过渡显示滚动条 */
}

.playlist:hover::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.3); /* 滑块半透明 */
}

/* 鼠标悬浮在滚动条滑块上时 */
.playlist::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.5); /* 滑块更明显 */
}

.playlist ul {
  list-style: none;
  padding: 0;
}

.playlist li {
  cursor: pointer;
  padding: 10px 10px 10px 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.playlist li.playing {
  background-color: #b6b6b636;
  color: #22de9c;
}

.playlist li span {
  margin-left: 10px;
  cursor: pointer;
  font-size: 25px;
}

.progress-bar {
  width: 100%;
  margin: 20px 0px 10px 0px;
  -webkit-appearance: none;
  background: #444;
  height: 5px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.3s; /* 平滑过渡 */
}

.progress-bar::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 15px;
  height: 15px;
  background: #ffffff;
  border-radius: 50%;
  cursor: pointer;
}

.progress-bar:hover::-webkit-slider-thumb {
  background: #22de9c; /* 鼠标悬停时滑块变色 */
}

.progress-bar:hover {
  background: #666;
}
</style>
