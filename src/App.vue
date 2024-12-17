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
          @input="updateProgressDisplay"
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
              class="mdi mdi-repeat-off"
            ></span>
            <span v-else class="mdi mdi-shuffle"></span>
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

        <div class="playlist">
          <h3>播放列表</h3>
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
                class="mdi mdi-delete"
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
    muted
    autoplay
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
    const loopModes = ["单曲循环", "顺序循环", "随机播放"];
    const currentLoopMode = ref(0);
    const progress = ref(0);
    let trackDuration = 0;
    let pausedTime = 0;
    const visualizerType = ref<"circle" | "tree">("circle"); // 当前可视化类型

    const toggleVisualizerType = () => {
      visualizerType.value =
        visualizerType.value === "circle" ? "tree" : "circle";
    };

    const initializeAudio = () => {
      if (!audioContext.value) {
        audioContext.value = new (window.AudioContext ||
          window.webkitAudioContext)();
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

    const resetAudioContext = () => {
      if (audioContext.value && audioContext.value.state !== "closed") {
        audioContext.value.close();
        audioContext.value = null;
        audioSource.value = null;
      }
    };

    const loadTrack = async (index: number) => {
      if (audioElement.value) {
        const track = tracks[index];
        audioElement.value.src = URL.createObjectURL(track.file);
        audioElement.value.load();
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
        trackDuration = audioElement.value.duration;
        progress.value = (audioElement.value.currentTime / trackDuration) * 100;
      }
    };

    const seekTrack = () => {
      if (audioElement.value) {
        const seekTime = (progress.value / 100) * trackDuration;
        audioElement.value.currentTime = seekTime;

        if (isPlaying.value) {
          audioElement.value.play();
        }
      }
    };

    // 在播放按钮事件中调用
    const togglePlay = async () => {
      if (!audioContext.value) {
        initializeAudio();
      } else if (audioContext.value.state === "suspended") {
        await audioContext.value.resume();
      }

      if (!audioElement.value) return;

      try {
        if (audioElement.value.muted) {
          audioElement.value.muted = false; // 取消静音
        }

        if (isPlaying.value) {
          audioElement.value.pause();
          isPlaying.value = false;
        } else {
          await audioElement.value.play();
          isPlaying.value = true;
          visualize();
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

    const onTrackEnd = () => {
      switch (currentLoopMode.value) {
        case 0: // 单曲循环
          if (audioElement.value) {
            audioElement.value.currentTime = 0;
            audioElement.value.play();
          }
          break;
        case 1: // 顺序循环
        case 2: // 随机播放
          nextTrack();
          break;
      }
    };

    const visualize = () => {
      const canvas = document.getElementById("visualizer") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d");

      if (!ctx || !analyser.value) return;

      canvas.width = 600;
      canvas.height = 600;

      const bufferLength = analyser.value.frequencyBinCount;
      dataArray.value = new Uint8Array(bufferLength);

      const draw = () => {
        if (!isPlaying.value) return;

        analyser.value.getByteFrequencyData(dataArray.value);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

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
          const barHeight = (dataArray.value[i] / 255) * canvas.height *0.8;


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
  width: 100%;
  flex-direction: row;
  display: flex;
  justify-content: center;
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
}

button:focus {
  outline: none; /* 确保点击聚焦时也没有白边 */
}

button:hover {
  background-color: #b6b6b636;
  color: #22de9c;
}

.custom-file-upload {
  display: inline-block;
  padding: 10px 20px;
  font-size: 16px;
  background-color: transparent;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  margin: 0 5px;
  width: 100px;
}

.custom-file-upload:hover {
  background-color: #b6b6b636;
  color: #22de9c;
  height: 90px;
}

.custom-file-upload input {
  display: none;
}

.playlist {
  margin-top: 20px;
  text-align: left;
  width: 600px;
}

.playlist ul {
  list-style: none;
  padding: 0;
}

.playlist li {
  cursor: pointer;
  padding: 5px 5px 5px 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.playlist li.playing {
  background-color: #e6e6e63f;
}

.playlist li span {
  margin-left: 10px;
  cursor: pointer;
  font-size: 25px;
}

.progress-bar {
  width: 100%;
  margin: 10px 0;
  -webkit-appearance: none;
  background: #444;
  height: 5px;
  border-radius: 5px;
  cursor: pointer;
}

.progress-bar::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 15px;
  height: 15px;
  background: #ffffff;
  border-radius: 50%;
  cursor: pointer;
}

.progress-bar:hover {
  background: #666;
}
</style>
