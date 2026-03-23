let isCoordinatesEdited = false; // 初始为未手动修改
let isDragging = false;
let dragStartX, dragStartZ;
let dragStartClientX, dragStartClientY;
let isPreviewUpdateScheduled = false; // 添加缺失的变量定义
let dragEndPreviewTimer = null; // 用于拖拽结束后延迟更新预览的定时器
let zoomLevel = -1; // 当前缩放级别，默认为-1
let isZooming = false;
let initialPinchDistance = 0; // 双指初始距离
let currentPinchDistance = 0; // 双指当前距离
let initialZoomLevel = 0; // 初始缩放级别
let lastZoomDelta = 0; // 上一次的缩放增量，用于检测变化

// 导出到window对象
window.zoomLevel = zoomLevel;
window.isZooming = isZooming;
window.initialZoomLevel = initialZoomLevel;
window.isPreviewUpdateScheduled = isPreviewUpdateScheduled;

// 本地标记点存储键名
const LOCAL_MARKERS_KEY = 'localMarkers';

// 计算两点间距离
function getDistance(touch1, touch2) {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

// 开始缩放
function startZoom(event) {
    if (event.touches && event.touches.length >= 2) {
        isZooming = true;
        initialPinchDistance = getDistance(event.touches[0], event.touches[1]);
        initialZoomLevel = zoomLevel;
        lastZoomDelta = 0; // 重置上一次的缩放增量
        event.preventDefault();
        
        // 添加触摸移动和结束事件监听器
        document.addEventListener('touchmove', handlePinch, { passive: false });
        document.addEventListener('touchend', stopZoom, { passive: false });
        document.addEventListener('touchcancel', stopZoom, { passive: false });
    }
}

// 处理双指捏合缩放
function handlePinch(event) {
    if (!isZooming || event.touches.length < 2) return;
    
    currentPinchDistance = getDistance(event.touches[0], event.touches[1]);
    
    // 计算缩放比例
    const scaleRatio = currentPinchDistance / initialPinchDistance;
    
    // 根据缩放比例调整缩放级别
    // 使用对数计算使缩放更平滑
    const zoomDelta = Math.round(Math.log2(scaleRatio) * 1.5);
    
    // 只有当zoomDelta发生变化时才触发缩放
    if (zoomDelta !== lastZoomDelta) {
        const deltaChange = zoomDelta - lastZoomDelta;
        
        if (deltaChange > 0) {
            handleZoomIn();
            if (navigator.vibrate) {
                navigator.vibrate(50); // 跨越整数级别时震动反馈
            }
        } else if (deltaChange < 0) {
            handleZoomOut();
            if (navigator.vibrate) {
                navigator.vibrate(50); // 跨越整数级别时震动反馈
            }
        }
        
        lastZoomDelta = zoomDelta; // 更新上一次的缩放增量
    }
    
    event.preventDefault();
}

// 停止缩放
function stopZoom() {
    if (!isZooming) return;
    isZooming = false;
    initialPinchDistance = 0;
    currentPinchDistance = 0;
    //updatePreview();
    
    // 移除事件监听器
    document.removeEventListener('touchmove', handlePinch);
    document.removeEventListener('touchend', stopZoom);
    document.removeEventListener('touchcancel', stopZoom);
}

// 开始拖拽
function startDrag(event) {
    // 只响应鼠标左键拖拽或触屏开始
    if (event.type === 'mousedown' && event.button !== 0) return;
    if (event.type === 'touchstart' && event.touches.length === 0) return;
    
    isDragging = true;
    // 处理鼠标和触屏事件
    let clientX, clientY;
    if (event.type === 'mousedown') {
        clientX = event.clientX;
        clientY = event.clientY;
    } else if (event.type === 'touchstart') {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    }
    
    // 获取当前坐标
    const xInput = document.getElementById('coordinates-x');
    const zInput = document.getElementById('coordinates-z');
    // 记录起始坐标
    dragStartClientX = clientX;
    dragStartClientY = clientY;
    dragStartX = parseFloat(xInput.value);
    dragStartZ = parseFloat(zInput.value);
    
    // 添加鼠标移动和释放事件监听器
    document.addEventListener('mousemove', drag, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchmove', drag, { passive: false });
    document.addEventListener('touchend', endDrag);
    document.addEventListener('touchcancel', endDrag);
    
    // 阻止默认行为，防止页面滚动等
    event.preventDefault();
}

// 拖拽过程中
function drag(event) {
    if (!isDragging) return;
    
    // 处理鼠标和触屏事件
    let clientX, clientY;
    if (event.type === 'touchmove') {
        // 检查触摸点是否存在
        if (event.touches.length === 0) return;
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    } else if (event.type === 'mousemove') {
        clientX = event.clientX;
        clientY = event.clientY;
    } else {
        return; // 其他事件不处理
    }
    
    // 计算鼠标/触摸点移动的距离
    const deltaX = clientX - dragStartClientX;
    const deltaY = clientY - dragStartClientY;
    
    // 根据移动距离计算新的坐标
    // 鼠标/手指向右移动时，地图向左移动，显示更右边的内容（X坐标减少）
    // 鼠标/手指向下移动时，地图向上移动，显示更下边的内容（Z坐标减少）
    const sensitivity = (event.type === 'touchmove' ? 2 : 1) * Math.pow(2, zoomLevel * -1); // 提高触屏灵敏度
    let newX = dragStartX - deltaX * sensitivity;
    let newZ = dragStartZ - deltaY * sensitivity;
    
    // 对坐标值进行四舍五入取整
    newX = Math.round(newX);
    newZ = Math.round(newZ);
    
    // 更新坐标输入框
    const xInput = document.getElementById('coordinates-x');
    const zInput = document.getElementById('coordinates-z');
    xInput.value = newX;
    zInput.value = newZ;
    
    // 标记为手动修改
    isCoordinatesEdited = true;
    
    // 优化：适度的实时预览更新，平衡性能和用户体验
    if (!isPreviewUpdateScheduled) {
        isPreviewUpdateScheduled = true;
        requestAnimationFrame(() => {
            // 拖拽过程中也更新预览，但使用更低的更新频率
            updatePreview(true); // 传入参数表示这是拖拽更新
            triggerSearch();
            isPreviewUpdateScheduled = false;
        });
    }
    
    // 只在触屏移动时阻止默认行为，防止页面滚动
    if (event.type === 'touchmove') {
        event.preventDefault();
    }
}

// 结束拖拽
function endDrag() {
    
    // 移除所有可能的事件监听器
    document.removeEventListener('mousemove', drag);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchmove', drag);
    document.removeEventListener('touchend', endDrag);
    document.removeEventListener('touchcancel', endDrag);
    
    // 拖拽结束后延迟更新预览图，确保最终位置正确显示
    if (dragEndPreviewTimer) {
        clearTimeout(dragEndPreviewTimer);
    }
    dragEndPreviewTimer = setTimeout(() => {
        updatePreview();
        isDragging = false;
    }, 300);
}

// 1. 在script.js顶部添加防抖函数（如果不存在）
function debounce(func, delay) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(this, args), delay);
    };
}

// 3. 添加布局调整函数（根据需要）
function adjustPreviewLayout() {
    const preview = document.querySelector('.preview-container');
    const tileContainer = preview.querySelector('.tile-container');
    if (tileContainer) {
        tileContainer.querySelectorAll('img').forEach(img => {
            img.style.transition = 'all 0.3s ease-in-out';
        });
        // 重新计算图片位置
        updatePreview();
        setTimeout(() => {
            tileContainer.querySelectorAll('img').forEach(img => {
                img.style.transition = '';
            });
        }, 100);
    }
}

// 1. 缓存数据避免重复请求
let cachedMarkers = null;

function fullToHalf(c) {
    const code = c.charCodeAt(0);
    if (code >= 0xFF10 && code <= 0xFF29) return String.fromCharCode(code - 0xfee0); // 全角数字
    if (code >= 0xFF41 && code <= 0xFF5A) return String.fromCharCode(code - 0xfee0); // 全角小写
    if (code >= 0xFF21 && code <= 0xFF3A) return String.fromCharCode(code - 0xfee0); // 全角大写
    if (code === 0xFF08 || code === 0xFF09) return String.fromCharCode(code - 0xfee0); // 全角括号
    return convertToHalfWidth(c);
}

// 2. 创建字符转换函数
function convertToHalfWidth(text) {
    return text
        .replace(/[\uff01-\uff5e]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全角符号转半角
        .replace(/\u3000/g, ' ') // 全角空格转半角空格
        .replace(/　/g, ' ');    // 全角空格的另一种编码
}

// 3. 获取并解析JS文件数据
// 优化后的 fetchMarkersData 函数
async function fetchMarkersData() {
    if (cachedMarkers) return cachedMarkers;
    
    try {
        const response = await fetch('https://map.shangxiaoguan.top/custom.markers.js');
        if (!response.ok) throw new Error(`HTTP错误: ${response.status}`);
        const scriptContent = await response.text();
        
        //console.log("加载的脚本内容:", scriptContent); // 调试信息
        
        // 创建安全执行环境
        const sandbox = { UnminedCustomMarkers: null };
        // ✅ 移除 exports 参数，直接执行脚本返回值
        const func = new Function(`return (${scriptContent})`);
        sandbox.UnminedCustomMarkers = func();
        
        //console.log("解析后的对象:", sandbox); // 调试信息
        
        // 验证数据结构
        if (
            !sandbox.UnminedCustomMarkers 
            || !Array.isArray(sandbox.UnminedCustomMarkers.markers)
        ) {
            throw new Error("数据格式错误：未找到markers数组");
        }
        
        // 提取所需字段
        const markers = sandbox.UnminedCustomMarkers.markers.map(marker => ({
            text: marker.text
                ? marker.text
                    .replace(/\n/g, '')          // 删除换行符
                    .replace(/　/g, '')         // 全角空格转半角空格
                    .trim()                      // 移除首尾空格
                : '',
            x: marker.x,
            z: marker.z,
            image: marker.image,
            source: 'data'
        }));
        
        cachedMarkers = markers;
        
        // 检查并删除本地重复的标记点
        removeDuplicateLocalMarkers(markers);
        window.markers = markers;
        
        return markers;
    } catch (err) {
        console.error("数据加载失败:", err);
        throw err;
    }
}

// 删除与服务器标记点重复的本地标记点
function removeDuplicateLocalMarkers(serverMarkers) {
    let localMarkers = getLocalMarkers();
    let removedCount = 0;
    
    // 检查每个本地标记点是否与服务器标记点重复
    localMarkers = localMarkers.filter(localMarker => {
        const isDuplicate = serverMarkers.some(serverMarker => {
            // 判断条件：坐标相同且名称相同且图片相同
            return (
                serverMarker.x === localMarker.x &&
                serverMarker.z === localMarker.z &&
                serverMarker.text === localMarker.text &&
                serverMarker.image === localMarker.image
            );
        });
        
        if (isDuplicate) {
            removedCount++;
            return false; // 过滤掉重复的标记点
        }
        return true; // 保留不重复的标记点
    });
    
    // 如果有删除的标记点，则更新localStorage
    if (removedCount > 0) {
        localStorage.setItem(LOCAL_MARKERS_KEY, JSON.stringify(localMarkers));
        showToast(`有${removedCount}个标记点被采纳，已自动删除。`);
        //console.log(`已自动删除 ${removedCount} 个与服务器重复的本地标记点`);
    }
}

// 错误处理优化
document.getElementById('search-input').addEventListener('input', async function() {
    try {
        const query = this.value.trim();
        if (!query) return;
        const results = await searchMarkers(query);
        renderResults(results);
    } catch (err) {
        const message = 
            err.message.includes("HTTP错误") 
            ? "文件加载失败，请检查路径或网络" 
            : err.message.includes("未找到数据定义") 
            ? "数据格式错误，请检查文件内容" 
            : "未知错误，请查看控制台";
        
        console.error("搜索失败:", err);
        showToast(message);
    }
    triggerSearch();
});

// 4. 搜索函数
async function searchMarkers(query, selectedCategory) {
    const serverMarkers = await fetchMarkersData();
    const localMarkers = getLocalMarkers().map(marker => ({
        ...marker,
        source: 'local'
    }));
    const allMarkers = [...localMarkers, ...serverMarkers];
    
    const normalizedQuery = convertToHalfWidth(query).trim().toLowerCase();
    
    return allMarkers.filter(marker => {
        const processedText = marker.text 
            ? Array.from(marker.text).map(c => fullToHalf(c)).join('')
            : '';
        const category = categoryMap[marker.image.replace(/\.png$/, '')] || '其他';
        return (
            processedText.toLowerCase().includes(normalizedQuery) &&
            (!selectedCategory || category === selectedCategory)// 使用分类筛选参数
        );
    });
}

// 全局作用域（文件顶部）
const categoryMap = {
    'bank': '银行',
    'bookstore': '书店',
    'building': '办公楼',
    'business': '商业',
    'bus-stop': '公交车站',
    'cafe': '咖啡厅/茶馆',
    'cinema': '电影院',
    'coach-station': '客运站',
    'drinks': '饮品店',
    'eastern-restaurant': '中餐',
    'factory': '工厂/基地',
    'ferry-port': '轮渡码头',
    'fireman': '消防站',
    'fix': '维修',
    'gas-station': '加油站',
    'gov1': '政府机构',
    'hospital': '医院',
    'hotel': '宾馆',
    'hot-spring': '洗浴',
    'lindong-metro': '地铁站',
    'lindong-metro-transfer': '地铁站',
    'songshanhu-tram': '有轨站',
    'local-railway-station': '专用线车站',
    'museum': '文教设施',
    'park': '公园',
    'parking': '停车场',
    'pharmacy': '药店',
    'photo': '照相馆/复印社',
    'police': '警察局',
    'post-office': '邮局',
    'public-service': '政府机构',
    'railway-station': '火车站',
    'residence': '住宅',
    'road': '道路',
    'roadpoint': '道路',
    'scenery': '景点',
    'school': '学校',
    'shop': '店铺',
    'songshanhu-tram': '有轨车站',
    'stadium': '体育场馆',
    'toll-gate': '收费站',
    'way-in': '入口',
    'way-out': '出口',
    'western-restaurant': '西餐',
    'exit': '出口',
};

// 5. 结果渲染函数
// 修改后的 renderResults 函数
function renderResults(results) {
    const xInput = document.getElementById('coordinates-x');
    const zInput = document.getElementById('coordinates-z');
    const x = parseFloat(xInput.value);
    const z = parseFloat(zInput.value);

    // 按距离排序（升序）
    results.sort((a, b) => {
        const distA = Math.sqrt((a.x - x) ** 2 + (a.z - z) ** 2);
        const distB = Math.sqrt((b.x - x) ** 2 + (b.z - z) ** 2);
        return distA - distB;
    });

    // 清空结果容器
    const resultContainer = document.querySelector('.search-result');
    resultContainer.innerHTML = '';
    
    // 先显示前10个结果
    const initialResults = results.slice(0, 10);
    const remainingResults = results.slice(10);
    
    // 如果有正在进行的延迟加载，清除它
    if (renderResults.timeoutId) {
        clearTimeout(renderResults.timeoutId);
    }
    
    function renderMarkers(markers) {
        markers.forEach((marker) => {
            const item = document.createElement('div');
            item.className = 'search-item';
            item.dataset.x = marker.x;
            item.dataset.z = marker.z;

            // 计算并显示距离
            const distance = Math.sqrt(
                (marker.x - x) ** 2 + 
                (marker.z - z) ** 2
            ).toFixed(0);

            // 获取分类名称：除了去掉图标后缀名，还需要去掉-a、-b、-c1等文件名后缀
            const categoryName = 
                categoryMap[marker.image.replace(/\.png$/, '')] || 
                (marker.image.includes('highway-') ? '高速公路' : '其他');
            item.setAttribute('data-category', marker.image);
            const itemTitle = 
                marker.text || 
                (
                    marker.image.includes('highway-') ?
                    marker.image.replace(/^highway-/, '').split('.')[0].toUpperCase() :
                    categoryName
                );
            
            item.innerHTML = `
                <div class="search-item-text">
                    <div class="search-item-name">${itemTitle}</div>
                    <div class="caption">
                        <div class="search-item-not-approved">尚未采纳</div>
                        <div class="search-item-category">${categoryName}</div>
                        <div class="search-item-coordinate">距离${distance}格</div>
                    </div>
                </div>
                <div class="search-item-actions"> 
                    <button class="icon-button" id="teleport-button" title="复制传送指令">
                        <img src="/UI/res/code_black.png" alt="复制传送指令"></img>
                    </button>
                    <!--<button class="icon-button" id="toggle-favorite-button" title="添加收藏">
                        <img src="/UI/res/favorite_outline_black.png" alt="收藏标记点"></img>
                    </button>-->
                </div>
            `;

            const notApproved = item.querySelector('.search-item-not-approved');

            // 如果标记点能在LocalStorage中找到，则保留本地标记样式，否则隐藏
            if (marker.source === 'local') {
                notApproved.style.display = 'block';
            } else {
                notApproved.style.display = 'none';
            }
            
            // 点击事件处理
            item.addEventListener('click', async function(e) {
                // 移除所有选中项
                const allItems = document.querySelectorAll('.search-item');
                allItems.forEach(item => item.classList.remove('selected'));

                // 添加当前选中状态
                this.classList.add('selected');

                // 更新输入框和预览
                document.getElementById('coordinates-x').value = marker.x;
                document.getElementById('coordinates-z').value = marker.z;
                
                // 处理道路路径显示
                // 如果不是道路点，则正常更新预览
                if (!marker.image.includes('roadpoint') && !marker.image.includes('highway-')) {
                    updatePreview();
                } else {
                    await handleRoadPathDisplay(marker);
                }

                // 重新触发搜索以重新排序
                triggerSearch();
            });

            const teleportButton = item.querySelector('#teleport-button');
            teleportButton.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                navigator.clipboard.writeText(`/tp @s ${marker.x} ~ ${marker.z}`)
                    .then(() => {
                        showToast('传送指令已复制到剪贴板');
                    })
                    .catch(() => {
                        showToast('无法复制传送指令');
                    });
            });
            
            resultContainer.appendChild(item);
        });
    }
    
    // 渲染前10个结果
    renderMarkers(initialResults);
    
    // 1秒后渲染剩余结果
    if (remainingResults.length > 0) {
        renderResults.timeoutId = setTimeout(() => {
            renderMarkers(remainingResults);
            renderResults.timeoutId = null;
            
            // 刷新 tile-container
            updatePreview();
            
            // 触发自定义事件通知瓦片清理
            window.dispatchEvent(new CustomEvent('searchResultsComplete'));
        }, 1000);
    }

    // 自动选中逻辑（保留原有条件判断）
    if (results.length > 0) {
        const firstItem = resultContainer.querySelector('.search-item');
        if (firstItem) {
            const allItems = document.querySelectorAll('.search-item');
            allItems.forEach(item => item.classList.remove('selected'));
            firstItem.classList.add('selected');

            // 仅在非手动输入时自动选中首个结果
            if (!isManualInput()) {
                firstItem.click(); // 触发点击事件以更新预览
            }
        }
    } else {
        const allItems = document.querySelectorAll('.search-item');
        allItems.forEach(item => item.classList.remove('selected'));
    }

    // 显示/隐藏逻辑保持不变
    if (results.length === 0) {
        resultContainer.style.display = 'none';
    } else {
        resultContainer.style.display = 'block';
    }

    // ✅ 滚动到最顶部
    resultContainer.scrollIntoView({ behavior: 'smooth' });

    // ✅ 滚动整个页面到最顶部
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 新增：检查指定坐标附近是否有标记点
async function checkNearbyMarkers(x, z) {
    const markers = await fetchMarkersData();
    return markers.some(marker => {
        const distance = Math.sqrt((marker.x - x) ** 2 + (marker.z - z) ** 2);
        return distance < 1;
    });
}

// 修改 triggerSearch 函数以处理空查询
async function triggerSearch() {
    const xInput = document.getElementById('coordinates-x');
    const zInput = document.getElementById('coordinates-z');
    const x = parseFloat(xInput.value);
    const z = parseFloat(zInput.value);
    
    const query = document.getElementById('search-input').value.trim();
    const selectedCategory = document.getElementById('category-filter').value; // 获取分类筛选参数
    
    // 检查附近是否有标记点（使用完整数据集）
    const hasNearbyMarkers = await checkNearbyMarkers(x, z);
    const noResultsElement = document.querySelector('.no-results');
    if (noResultsElement) {
        if (!hasNearbyMarkers) {
            // 1格范围内没有标记点，显示提示
            noResultsElement.style.display = 'block';
        } else {
            // 1格范围内有标记点，隐藏提示
            noResultsElement.style.display = 'none';
        }
    }
    
    try {
        const results = await searchMarkers(query, selectedCategory); // 传递分类筛选参数
        renderResults(results);
        updatePreview();
    } catch (err) {
        console.error("搜索失败:", err);
        showToast(err.message);
    }
}

// 修改检测手动输入的函数
function isManualInput() {
    return isCoordinatesEdited; // 直接返回标志变量
}

// 新增：处理预览功能（支持多图拼接）
// 防抖函数，用于限制updatePreview的调用频率
let previewUpdateTimer = null;
let lastUpdatePreviewCall = 0;
const previewUpdateDelay = 24; // 调整为24ms，约42FPS，在性能和流畅性之间取得平衡


function updatePreview(isDragUpdate = false) {
    const now = Date.now();
    
    // 性能监控：记录执行时间
    const startTime = performance.now();
    
    // 拖拽更新使用更宽松的限制，普通更新使用严格限制
    const effectiveDelay = isDragUpdate ? 64 : previewUpdateDelay; // 拖拽时64ms，普通时32ms
    
    // 如果距离上次调用时间很短，则推迟执行
    if (now - lastUpdatePreviewCall < effectiveDelay || isZooming) {
        // 清除之前的定时器
        if (previewUpdateTimer) {
            clearTimeout(previewUpdateTimer);
        }
        
        // 设置新的定时器
        previewUpdateTimer = setTimeout(() => {
            doUpdatePreview(isDragUpdate);
            lastUpdatePreviewCall = Date.now();
        }, previewUpdateDelay - (now - lastUpdatePreviewCall));
        
        return;
    }
    
    // 直接执行更新
    doUpdatePreview();
    lastUpdatePreviewCall = now;
}
window.updatePreview = updatePreview;

// 实际执行预览更新的函数
function doUpdatePreview() {
    const xInput = document.getElementById('coordinates-x');
    const zInput = document.getElementById('coordinates-z');
    const x = parseFloat(xInput.value);
    const z = parseFloat(zInput.value);
    
    if (isNaN(x) || isNaN(z)) {
        //clearPreview();
        return;
    }
    
    // 计算当前tile坐标
    const tileX = Math.floor(x / 256 / Math.pow(2, zoomLevel * -1));
    const tileZ = Math.floor(z / 256 / Math.pow(2, zoomLevel * -1));
    
    // 需要加载的tile列表：当前及周围8个方向
    const tilesToLoad = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            tilesToLoad.push({
                x: tileX + dx,
                z: tileZ + dz,
                zoomLevel: zoomLevel
            });
        }
    }
    
    // 获取预览容器，如果不存在则创建
    const previewContainer = document.querySelector('.preview-container');
    let tileContainer = previewContainer.querySelector('.tile-container');
    if (!tileContainer) {
        tileContainer = document.createElement('div');
        tileContainer.className = 'tile-container';
        previewContainer.appendChild(tileContainer);
    }
    
    // 获取当前已加载的图片信息
    const loadedTiles = new Map();
    const images = tileContainer.querySelectorAll('img');
    images.forEach(img => {
        img.style.position = 'relative';
        img.style.opacity = 0;
        const key = img.dataset.tileKey;
        if (key) {
            loadedTiles.set(key, img);
        }
    });
    
    // 计算需要新增和需要移除的瓦片
    const tilesToLoadMap = new Map();
    tilesToLoad.forEach(tile => {
        const key = `${tile.x},${tile.z}@${tile.zoomLevel >= 0 ? `${Math.pow(2, tile.zoomLevel)}x` : `1/${Math.pow(2, -tile.zoomLevel)}x`}`;
        tilesToLoadMap.set(key, tile);
    });
    
    // 移除不需要的图片
    loadedTiles.forEach((img, key) => {
        if (!tilesToLoadMap.has(key)) {
            img.remove();
        }
    });
    
    // 更新所有图片的位置（包括已存在的和新加载的）
    const updateImagePosition = (img, tx, tz, zoomLevel) => {
        // 计算容器尺寸
        const containerWidth = previewContainer.offsetWidth;
        const containerHeight = previewContainer.offsetHeight;
        
        // 当前tile的地理左上角坐标
        const tileLeftGeo = tx * 256 * Math.pow(2, zoomLevel * -1);
        const tileTopGeo = tz * 256 * Math.pow(2, zoomLevel * -1);
        
        // 用户坐标到当前tile左上角的偏移量（地理单位）
        const dxGeo = x - tileLeftGeo;
        const dzGeo = z - tileTopGeo;
        
        // 转换为像素坐标（对于缩放等级-2，1像素=4地理单位）
        const dxPixel = dxGeo / Math.pow(2, zoomLevel * -1) - 128;
        const dzPixel = dzGeo / Math.pow(2, zoomLevel * -1) - 128;
        
        // 图片左上角相对于容器中心的偏移
        const imgLeft = containerWidth / 2 - dxPixel - img.width / 2;
        const imgTop = containerHeight / 2 - dzPixel - img.height / 2;
        
        // 设置绝对定位
        img.style.position = 'absolute';
        img.style.left = `${imgLeft}px`;
        img.style.top = `${imgTop}px`;
        img.style.opacity = 1;
        
        // 防止图片被截断
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';
    };
    
    // 先更新已存在的图片位置
    loadedTiles.forEach((img, key) => {
        if (tilesToLoadMap.has(key)) {
            const tile = tilesToLoadMap.get(key);
            updateImagePosition(img, tile.x, tile.z, tile.zoomLevel);
        }
    });
    
    // 加载需要新增的图片
    const promises = [];
    tilesToLoadMap.forEach((tile, key) => {
        // 如果图片已经存在，跳过加载过程（但位置已经在上面更新了）
        if (loadedTiles.has(key)) {
            return;
        }
        
        const promise = new Promise((resolve, reject) => {
            const { x: tx, z: tz } = tile;
            
            // 计算路径
            const xDir = Math.floor(tx / 10);
            const zDir = Math.floor(tz / 10);
            const imageUrl = `https://map.shangxiaoguan.top/tiles/zoom.${zoomLevel}/${xDir}/${zDir}/tile.${tx}.${tz}.jpeg`;
            
            const img = new Image();
            img.src = imageUrl;
            img.dataset.tileKey = key; // 添加标识
            
            img.onload = () => {
                updateImagePosition(img, tx, tz, tile.zoomLevel);
                tileContainer.appendChild(img);
                resolve(img);
            };
            
            img.onerror = () => {
                resolve(null);
            };
        });
        
        promises.push(promise);
    });

    const pinLabel = document.querySelector('.pin-label');
    const pinImg = pinLabel.parentElement.querySelector('img');
    const currentLocation = document.querySelector('.search-item.selected .search-item-name');
    const locationDistance = document.querySelector('.search-item.selected .search-item-coordinate');
    if (currentLocation && locationDistance) { 
        const distanceMatch = locationDistance.textContent.match(/\d+/);
        if (distanceMatch) {
            const distance = distanceMatch[0];

            const currentLocationCategory = currentLocation.parentElement.querySelector('.search-item-category');
            const currentCategoryData = document.querySelector('.search-item.selected').dataset.category;
            if (currentLocationCategory.textContent === '道路' || currentLocationCategory.textContent === '高速公路') {
                // 重构SVG定位和缩放代码
                const svg = document.querySelector('svg');
                
                if (svg && (svg.dataset.name === currentLocation.textContent || svg.dataset.name === currentCategoryData)) {
                    // 获取SVG的viewport信息
                    const viewBoxValues = svg.getAttribute('viewPort').split(' ');
                    const minX = parseFloat(viewBoxValues[0]);
                    const minZ = parseFloat(viewBoxValues[1]);
                    const width = parseFloat(viewBoxValues[2]);
                    const height = parseFloat(viewBoxValues[3]);
                    
                    // 获取容器尺寸
                    const containerRect = previewContainer.getBoundingClientRect();
                    const containerWidth = containerRect.width;
                    const containerHeight = containerRect.height;
                    
                    // 计算缩放倍数
                    const scale = Math.pow(2, zoomLevel);
                    
                    // 计算SVG元素的新位置，使其居中于指定坐标点(x, z)
                    // 这里假设x和z是之前已经定义好的坐标变量
                    const newTop = (containerHeight/2 - (z - minZ) * scale) + 'px';
                    const newLeft = (containerWidth/2 - (x - minX) * scale) + 'px';
                    
                    // 应用样式
                    svg.style.position = 'absolute';
                    svg.style.top = newTop;
                    svg.style.left = newLeft;
                    svg.style.overflow = 'visible';
                    svg.style.mixBlendMode = "overlay";
                    svg.style.zIndex = 10;
                    
                    // 应用缩放变换
                    svg.style.transform = `scale(${scale})`;
                    svg.style.transformOrigin = 'top left';

                    const polyline = svg.querySelector('polyline');
                    if (polyline) {
                        polyline.style.strokeWidth = `${32 / Math.sqrt(scale)}px`;
                    }
                } else { 
                    const currentCategory = document.querySelector('.search-item.selected').dataset.category;
                    console.log('currentCategory', currentCategory);
                    switch (currentLocationCategory.textContent) {
                        case '高速公路':
                            handleRoadPathDisplay({text: currentCategory, x: x, z: z, image: currentCategory});
                            break;
                        default: 
                            handleRoadPathDisplay({text: currentLocation.textContent, x: x, z: z, image: 'road.png'});
                    }
                }
                const polyline = svg?.querySelector('polyline');
                if (polyline) {
                    const points = polyline.getAttribute('points').split(' ');
                    pinImg.style.opacity = points.length > 1 ? 0 : 1;
                }
            } else { 
                const oldSvgs = previewContainer.querySelectorAll('svg');
                if (oldSvgs) {
                    oldSvgs.forEach(svg => {
                        svg.remove();
                    });
                }
                pinImg.style.opacity = 1;
            }
            if (distance > 0) {
                //console.log('隐藏地址');
                if (window.location.href.includes('map.html')) {
                    pinLabel.style.opacity = 0;
                }
            } else {
                const svg = document.querySelector('svg');
                const polyline = svg?.querySelector('polyline');
                const points = polyline?.getAttribute('points').split(' ');
                if (currentLocationCategory.textContent === '道路' && points.length > 1) {
                    const svgWidth = svg.getBoundingClientRect().width;
                    const svgHeight = svg.getBoundingClientRect().height;
                    if (svgWidth < svgHeight) { 
                        pinLabel.style.width = '1em';
                        pinLabel.style.textWrap = 'wrap';
                        pinLabel.style.transform = 'translateY(-400%)';
                    } else { 
                        pinLabel.style.width = '';
                        pinLabel.style.textWrap = '';
                        pinLabel.style.transform = 'translateY(-125%)';
                    }
                    
                    pinLabel.style.color = 'black';
                    pinLabel.style.textShadow = '0 0 4px white';
                    pinLabel.style.letterSpacing = '0.5em';
                    pinLabel.style.opacity = window.location.href.includes('map.html')? 1 : 0;
                } else {
                    // 对map.html执行以下代码
                    pinLabel.style.color = 'white';
                    pinLabel.style.textShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
                    pinLabel.style.width = '';
                    pinLabel.style.textWrap = '';
                    pinLabel.style.transform = '';
                    pinLabel.style.letterSpacing = '';
                    pinLabel.style.opacity = window.location.href.includes('map.html')?1:0;
                }
                pinLabel.textContent = currentLocation.textContent;
                console.log('显示地址', pinLabel.textContent);
                
            }
        }
    }

    const mapScale = previewContainer.querySelector('.map-scale');
    if (mapScale) {
        const scaleBar = mapScale.querySelector('.scale-bar');
        const scaleText = mapScale.querySelector('.scale-text');
        switch (zoomLevel) {
            case 2: 
                scaleText.textContent = '10格';
                setTimeout(() => { scaleBar.style.width = '40px'; }, 200);
                break;
            case 1: 
                scaleText.textContent = '20格';
                setTimeout(() => { scaleBar.style.width = '40px'; }, 200);
                break;
            case 0: 
                scaleText.textContent = '50格';
                setTimeout(() => { scaleBar.style.width = '50px'; }, 200);
                break;
            case -1: 
                scaleText.textContent = '100格';
                setTimeout(() => { scaleBar.style.width = '50px'; }, 200);
                break;
            case -2: 
                scaleText.textContent = '200格';
                setTimeout(() => { scaleBar.style.width = '50px'; }, 200);
                break;
            case -3: 
                scaleText.textContent = '500格';
                setTimeout(() => { scaleBar.style.width = '62.5px'; }, 200);
                break;
            case -4: 
                scaleText.textContent = '1000格';
                setTimeout(() => { scaleBar.style.width = '62.5px'; }, 200);
                break;
            case -5: 
                scaleText.textContent = '2000格';
                setTimeout(() => { scaleBar.style.width = '62.5px'; }, 200);
                break;
            case -6: 
                scaleText.textContent = '5000格';
                setTimeout(() => { scaleBar.style.width = '78.125px'; }, 200);
                break;
            default:
                scaleText.textContent = '1格';
                scaleBar.style.width = '8px';
                break;
        }
    }
    
    Promise.all(promises).then(() => {
        // 显示加载完成状态
        tileContainer.style.display = 'block';
        
        // 更新map-scale和preview-footer的颜色（目前因跨域问题暂无法启用）
        //updateMapElementsContrast(previewContainer);
    });
}

// 根据背景颜色调整map-scale和preview-footer的文本颜色
function updateMapElementsContrast(container) {
    // 获取map-scale和preview-footer元素
    const mapScale = container.querySelector('.map-scale');
    const previewFooter = container.querySelector('.preview-footer');
    
    if (!mapScale && !previewFooter) return;
    
    // 创建一个临时的canvas来获取中心点的颜色
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;
    
    // 在canvas上绘制当前预览容器的内容
    Promise.all(Array.from(container.querySelectorAll('img')).map(img => {
        return new Promise(resolve => {
            if (img.complete && img.naturalHeight !== 0) {
                ctx.drawImage(img, 
                    parseFloat(img.style.left) || 0, 
                    parseFloat(img.style.top) || 0, 
                    img.width, 
                    img.height);
                resolve();
            } else {
                img.onload = () => {
                    ctx.drawImage(img, 
                        parseFloat(img.style.left) || 0, 
                        parseFloat(img.style.top) || 0, 
                        img.width, 
                        img.height);
                    resolve();
                };
                img.onerror = () => resolve();
            }
        });
    })).then(() => {
        // 获取底部区域的颜色（map-scale在左下角，preview-footer在右下角）
        try {
            // 获取map-scale位置的颜色
            if (mapScale) {
                const scaleLeft = mapScale.offsetLeft + mapScale.offsetWidth / 2;
                const scaleTop = mapScale.offsetTop + mapScale.offsetHeight / 2;
                const scalePixel = ctx.getImageData(scaleLeft, scaleTop, 1, 1).data;
                const scaleBrightness = (scalePixel[0] * 299 + scalePixel[1] * 587 + scalePixel[2] * 114) / 1000;
                
                // 根据亮度设置文本颜色
                const scaleTextColor = scaleBrightness > 192 ? '#000' : '#fff';
                mapScale.style.color = scaleTextColor;
                mapScale.style.textShadow = scaleBrightness > 192 ? 
                    '0 1px 4px rgba(255,255,255,0.5)' : 
                    '0 1px 4px rgba(0,0,0,0.5)';
                
                // 更新scale-bar的颜色
                const scaleBar = mapScale.querySelector('.scale-bar');
                if (scaleBar) {
                    scaleBar.style.borderBottom = `2px solid ${scaleTextColor}`;
                    scaleBar.style.borderLeft = `1px solid ${scaleTextColor}`;
                    scaleBar.style.borderRight = `1px solid ${scaleTextColor}`;
                }
                
                const scaleText = mapScale.querySelector('.scale-text');
                if (scaleText) {
                    scaleText.style.color = scaleTextColor;
                }
            }
            
            // 获取preview-footer位置的颜色
            if (previewFooter) {
                const footerLeft = previewFooter.offsetLeft + previewFooter.offsetWidth / 2;
                const footerTop = previewFooter.offsetTop + previewFooter.offsetHeight / 2;
                const footerPixel = ctx.getImageData(footerLeft, footerTop, 1, 1).data;
                const footerBrightness = (footerPixel[0] * 299 + footerPixel[1] * 587 + footerPixel[2] * 114) / 1000;
                
                // 根据亮度设置文本颜色
                const footerTextColor = footerBrightness > 128 ? '#000' : '#fff';
                previewFooter.style.color = footerTextColor;
                previewFooter.style.textShadow = footerBrightness > 128 ? 
                    '0 2px 2px rgba(255,255,255,0.2)' : 
                    '0 2px 2px rgba(0,0,0,0.2)';
                    
                // 更新footer中所有p标签的颜色
                const paragraphs = previewFooter.querySelectorAll('p');
                paragraphs.forEach(p => {
                    p.style.color = footerTextColor;
                });
            }
        } catch (e) {
            // 在跨域情况下可能无法获取像素数据，使用默认样式
            console.warn('无法获取地图背景颜色信息，使用默认样式:', e);
        }
    });
}

// 清除预览（现在不再需要完整移除容器）
function clearPreview() {
    const previewContainer = document.querySelector('.preview-container');
    const tileContainer = previewContainer.querySelector('.tile-container');
    if (tileContainer) {
        // 清除容器内的图片，但保留容器本身
        tileContainer.innerHTML = '';
    }
}

// 添加事件监听
// 修改坐标输入事件监听器
document.getElementById('coordinates-x').addEventListener('input', function() {
    isCoordinatesEdited = true; // 标记为手动修改
    updatePreview();
});

document.getElementById('coordinates-z').addEventListener('input', function() {
    isCoordinatesEdited = true; // 标记为手动修改
    updatePreview();
});

// 添加拖拽事件监听器
const previewContainer = document.querySelector('.preview-container');
previewContainer.addEventListener('mousedown', startDrag);
previewContainer.addEventListener('touchstart', (event) => {
    // 区分拖拽和缩放
    if (event.touches && event.touches.length >= 2) {
        // 双指触摸 - 缩放
        event.preventDefault();
        startZoom(event);
    } else if (event.touches && event.touches.length === 1) {
        // 单指触摸 - 拖拽
        event.preventDefault();
        startDrag(event);
    }
}, { passive: false });

// 防止双指触摸时的页面缩放
previewContainer.addEventListener('touchmove', (event) => {
    if (event.touches && event.touches.length >= 2) {
        event.preventDefault();
    }
}, { passive: false });

// 添加缩放按钮事件监听器
const zoomButtons = document.querySelectorAll('.zoom-button');
if (zoomButtons.length > 0) { 
    document.getElementById('zoom-in').addEventListener('mousedown', handleZoomIn);
    document.getElementById('zoom-in').addEventListener('touchstart', handleZoomIn, { passive: false });
    document.getElementById('zoom-out').addEventListener('mousedown', handleZoomOut);
    document.getElementById('zoom-out').addEventListener('touchstart', handleZoomOut, { passive: false });
}
document.querySelector('.preview-container').addEventListener('wheel', function(e) {
    e.preventDefault();
    if (e.deltaY < 0) {
        handleZoomIn();
    } else {
        handleZoomOut();
    }
});

function handleZoomIn() {
    
    // 尝试更新缩放条宽度
    const scaleBar = document.querySelector('.scale-bar');
    if (scaleBar) {
        const scaleBarWidth = scaleBar.offsetWidth;
        scaleBar.style.width = `${scaleBarWidth * 1.1}px`;
    }
    zoomLevel = zoomLevel + 1;
    window.zoomLevel = zoomLevel;
    if (zoomLevel > 2) {
        zoomLevel = 2;
        window.zoomLevel = zoomLevel;
        showToast('已到达最大缩放级别', 1000);
        updatePreview();
        return;
    }
    
    // 更新预览
    updatePreview();
    
    // 提供用户反馈
    //showToast('缩放级别: ' + (zoomLevel >= 0 ? '' : '1/') + Math.pow(2, Math.abs(zoomLevel)) + 'x', 1000);
        
    
}

function handleZoomOut() {
    // 尝试更新缩放条宽度
    const scaleBar = document.querySelector('.scale-bar');
    if (scaleBar) {
        const scaleBarWidth = scaleBar.offsetWidth;
        scaleBar.style.width = `${scaleBarWidth * 0.9}px`;
    }
    zoomLevel = zoomLevel - 1;
    window.zoomLevel = zoomLevel;
    if (zoomLevel < -6) {
        zoomLevel = -6;
        window.zoomLevel = zoomLevel;
        showToast('已到达最小缩放级别', 1000);
        updatePreview();
        return;
    }
    
    // 更新预览
    updatePreview();
    
    // 提供用户反馈
    //showToast('缩放级别: ' + (zoomLevel >= 0 ? '' : '1/') + Math.pow(2, Math.abs(zoomLevel)) + 'x', 1000);
        
    
}

const imageBtn = document.getElementById('image-btn');
if (imageBtn) { 
    imageBtn.addEventListener('click', async () => {
        const locationName = document.querySelector('.search-item.selected .search-item-name');
        if (locationName) {
            await savePreviewImage(locationName.textContent);
        }
    });
}

document.getElementById('share-btn').addEventListener('click', () => {
    const x = document.getElementById('coordinates-x').value;
    const z = document.getElementById('coordinates-z').value;
    const query = document.getElementById('search-input').value.trim(); // 获取当前搜索词

    const urlBase = window.location.href.split('?')[0];
    let url = `${urlBase}?x=${x}&z=${z}&zoom=${zoomLevel}`; // 添加缩放等级参数
    if (query) {
        url += `&q=${encodeURIComponent(query)}`; // 添加关键词参数
    }

    navigator.clipboard.writeText(url).then(() => {
        showToast('链接已复制到剪贴板');
    });
});

// 仅在元素存在时添加事件监听器
const addNewPointElement = document.querySelector('.add-new-point');
if (addNewPointElement) {
    addNewPointElement.addEventListener('click', () => {
        const xCoordinate = document.getElementById('coordinates-x').value;
        const zCoordinate = document.getElementById('coordinates-z').value;
        openAddPointModal(xCoordinate, zCoordinate);
    });
}

// 添加新标记点模态框相关功能
document.addEventListener('DOMContentLoaded', () => {
    const xInput = document.getElementById('coordinates-x');
    const zInput = document.getElementById('coordinates-z');

    // 设置默认坐标（保留原逻辑）
    xInput.value = -1334;
    zInput.value = -490;

    // 解析URL参数
    const urlParams = new URLSearchParams(window.location.search);
    const xParam = parseFloat(urlParams.get('x'));
    const zParam = parseFloat(urlParams.get('z'));
    const queryParam = urlParams.get('q'); // 新增：获取关键词参数
    const categoryParam = urlParams.get('cat'); // 新增：获取分类参数
    const zoomParam = parseInt(urlParams.get('zoom')); // 新增：获取缩放等级参数

    // 优先使用URL参数覆盖默认值
    if (!isNaN(xParam)) xInput.value = xParam;
    if (!isNaN(zParam)) zInput.value = zParam;

    // ✅ 新增：如果坐标由URL参数设置，则不标记为手动输入
    if (urlParams.has('x') || urlParams.has('z')) {
        isCoordinatesEdited = false; // 重置为非手动输入
    }

    if (!isNaN(zoomParam)) { // 新增：处理缩放等级参数
        zoomLevel = zoomParam;
        window.zoomLevel = zoomLevel;
        updatePreview();
    }

    // 触发输入事件以更新预览
    xInput.dispatchEvent(new Event('input'));
    zInput.dispatchEvent(new Event('input'));

    // 新增：处理关键词参数
    if (queryParam) {
        const searchInput = document.getElementById('search-input');
        searchInput.value = queryParam;
        searchInput.dispatchEvent(new Event('input')); // 触发搜索逻辑
    }

    // 生成分类选项
    const categoryFilter = document.getElementById('category-filter');
    const uniqueCategories = Array.from(new Set(Object.values(categoryMap)));
    uniqueCategories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        categoryFilter.appendChild(option);
    });

    // 生成添加标记点模态框中的分类选项
    const pointCategorySelect = document.getElementById('point-category');
    if (pointCategorySelect) {
        // 添加一个默认选项
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '请选择分类';
        pointCategorySelect.appendChild(defaultOption);
    
        // 添加所有分类选项
        Object.keys(categoryMap).forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = categoryMap[key];
            pointCategorySelect.appendChild(option);
        });
    }

    // 监听分类选择变化
    categoryFilter.addEventListener('change', async () => {
        updateURLCategory(categoryFilter.value);
        await triggerSearch(); // 触发搜索逻辑
    });

    // 初始化时解析URL参数中的分类
    if (categoryParam) {
        categoryFilter.value = categoryParam;
        triggerSearch(); // 触发搜索逻辑
        if (!queryParam) {
            setTimeout(() => {
                showToast('需要输入查询参数（q=）才能触发按分类搜索', 5000);
            }, 1000);
        }
    }

    const coordinateInputs = document.querySelectorAll('.coordinates');
    coordinateInputs.forEach(input => {
        input.addEventListener('input', () => {
            const x = xInput.value;
            const z = zInput.value;
            triggerSearch();
        });
    });

    // 触发初始搜索
    triggerSearch().then(() => {
        // 如果URL有搜索参数但没有坐标参数，设置第一个搜索结果的坐标
        if (queryParam && (isNaN(xParam) || isNaN(zParam))) {
            const firstItem = document.querySelector('.search-item');
            if (firstItem) {
                const x = firstItem.dataset.x;
                const z = firstItem.dataset.z;
                xInput.value = x;
                zInput.value = z;
                xInput.dispatchEvent(new Event('input')); // 触发预览更新
                zInput.dispatchEvent(new Event('input')); // 触发预览更新
            }
        }
    });

    // 初始化预览
    triggerSearch();

    // 新增窗口大小监听
    window.addEventListener('resize', debounce(() => {
        adjustPreviewLayout();
    }, 200));
    
    // 添加模态框相关事件监听器
    const closeModal = document.getElementById('close-modal')
    if (closeModal) closeModal.addEventListener('click', closeAddPointModal);
    
    // 修改保存标记点按钮的事件监听器
    const savePointButton = document.getElementById('save-point');
    if (savePointButton) savePointButton.addEventListener('click', () => {
        const pointName = document.getElementById('point-name').value.trim();
        const pointCategory = document.getElementById('point-category').value;
        const xCoordinate = document.getElementById('coordinates-x').value;
        const zCoordinate = document.getElementById('coordinates-z').value;
        
        if (!pointName) {
            showToast('请输入标记点名称');
            return;
        }
        
        if (!pointCategory) {
            showToast('请选择分类');
            return;
        }
        
        // 创建标记点对象
        const marker = {
            x: parseFloat(xCoordinate),
            z: parseFloat(zCoordinate),
            text: pointName,
            image: pointCategory + '.png',
            source: 'local'
        };
        
        // 生成标记点代码
        const markerCode = generateMarkerCode(pointName, pointCategory, xCoordinate, zCoordinate);
        
        // 保存到localStorage
        if (saveLocalMarker(marker)) {
            showToast('标记点已保存到本地');
            navigator.clipboard.writeText(markerCode).then(() => {
                showToast('标记点代码已复制到剪贴板');
            });
            closeAddPointModal();
        } else {
            showToast('标记点已存在');
        }
    });
    
    const copyPointCodeButton = document.getElementById('copy-point-code');
    if (copyPointCodeButton) copyPointCodeButton.addEventListener('click', () => {
        const pointName = document.getElementById('point-name').value.trim();
        const pointCategory = document.getElementById('point-category').value;
        const xCoordinate = document.getElementById('coordinates-x').value;
        const zCoordinate = document.getElementById('coordinates-z').value;
        
        if (!pointName) {
            showToast('请输入标记点名称');
            return;
        }
        
        if (!pointCategory) {
            showToast('请选择分类');
            return;
        }
        
        // 保存到localStorage（新增功能）
        const marker = {
            x: parseFloat(xCoordinate),
            z: parseFloat(zCoordinate),
            text: pointName,
            image: pointCategory + '.png',
            source: 'local'
        };
        
        saveLocalMarker(marker);
        
        // 生成标记点代码
        const markerCode = generateMarkerCode(pointName, pointCategory, xCoordinate, zCoordinate);
        
        navigator.clipboard.writeText(markerCode).then(() => {
            showToast('标记点代码已复制到剪贴板');
            closeAddPointModal();
        });
    });
    
    const sendViaEmailButton = document.getElementById('send-via-email');
    if (sendViaEmailButton) sendViaEmailButton.addEventListener('click', () => {
        const pointName = document.getElementById('point-name').value.trim();
        const pointCategory = document.getElementById('point-category').value;
        const xCoordinate = document.getElementById('coordinates-x').value;
        const zCoordinate = document.getElementById('coordinates-z').value;

        if (!pointName) {
            showToast('请输入标记点名称');
            return;
        }
        
        if (!pointCategory) {
            showToast('请选择分类');
            return;
        }
        
        // 保存到localStorage（新增功能）
        const marker = {
            x: parseFloat(xCoordinate),
            z: parseFloat(zCoordinate),
            text: pointName,
            image: pointCategory + '.png',
            source: 'local'
        };
        
        saveLocalMarker(marker);
        
        // 生成标记点代码
        const markerCode = generateMarkerCode(pointName, pointCategory, xCoordinate, zCoordinate);
        
        // 生成邮件内容
        const subject = encodeURIComponent(`【新标记点申请】${pointName}`);
        const categoryName = categoryMap[pointCategory] || '其他';
        const body = encodeURIComponent(markerCode);
        const mailtoLink = `mailto:2020340248@qq.com?subject=${subject}&body=${body}`;
        
        window.location.href = mailtoLink;
    });
    
    // 点击模态框外部关闭模态框
    document.getElementById('add-point-modal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeAddPointModal();
        }
    });
    
    // 添加管理本地标记点模态框的事件监听器
    document.getElementById('list-btn').addEventListener('click', openManagePointsModal);
    document.getElementById('close-manage-modal').addEventListener('click', closeManagePointsModal);
    document.getElementById('manage-points-modal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeManagePointsModal();
        }
    });
    
    // 添加编辑标记点模态框的事件监听器
    document.getElementById('close-edit-modal').addEventListener('click', closeEditMarkerModal);
    document.getElementById('cancel-edit-point').addEventListener('click', closeEditMarkerModal);
    document.getElementById('save-edit-point').addEventListener('click', saveEditedMarker);
    document.getElementById('edit-point-modal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeEditMarkerModal();
        }
    });
    
    // 管理本地标记点工具栏事件监听器
    document.getElementById('toggle-all-points').addEventListener('click', toggleAllPoints);
    
    document.getElementById('delete-selected-points').addEventListener('click', function() {
        const selectedIndices = [];
        document.querySelectorAll('.manage-points-list input[type="checkbox"]:checked').forEach(checkbox => {
            selectedIndices.push(parseInt(checkbox.getAttribute('data-index')));
        });
        
        if (selectedIndices.length === 0) {
            showToast('请先选择要删除的标记点');
            return;
        }
        
        if (confirm(`确定要删除选中的 ${selectedIndices.length} 个标记点吗？`)) {
            deleteLocalMarkers(selectedIndices);
            showToast('标记点已删除');
            renderLocalMarkersList();
            // 更新搜索结果
            triggerSearch();
        }
    });
    
    document.getElementById('copy-selected-points').addEventListener('click', function() {
        const selectedIndices = [];
        document.querySelectorAll('.manage-points-list input[type="checkbox"]:checked').forEach(checkbox => {
            selectedIndices.push(parseInt(checkbox.getAttribute('data-index')));
        });
        
        if (selectedIndices.length === 0) {
            showToast('请先选择要复制的标记点');
            return;
        }
        
        const localMarkers = getLocalMarkers();
        let code = '';
        selectedIndices.forEach(index => {
            const marker = localMarkers[index];
            // 使用统一的标记点代码生成函数
            const pointCategory = marker.image.replace('.png', '');
            code += generateMarkerCode(marker.text, pointCategory, marker.x, marker.z) + '\n';
        });
        
        navigator.clipboard.writeText(code).then(() => {
            showToast('选中的标记点代码已复制到剪贴板');
        });
    });
    
    document.getElementById('send-selected-points').addEventListener('click', function() {
        const selectedIndices = [];
        document.querySelectorAll('.manage-points-list input[type="checkbox"]:checked').forEach(checkbox => {
            selectedIndices.push(parseInt(checkbox.getAttribute('data-index')));
        });
        
        if (selectedIndices.length === 0) {
            showToast('请先选择要发送的标记点');
            return;
        }
        
        const localMarkers = getLocalMarkers();
        let code = '';
        selectedIndices.forEach(index => {
            const marker = localMarkers[index];
            // 使用统一的标记点代码生成函数
            const pointCategory = marker.image.replace('.png', '');
            code += generateMarkerCode(marker.text, pointCategory, marker.x, marker.z) + '\n';
        });
        
        const subject = encodeURIComponent(`【新标记点申请】批量申请${selectedIndices.length}个标记点`);
        const body = encodeURIComponent(code);
        const mailtoLink = `mailto:2020340248@qq.com?subject=${subject}&body=${body}`;
        
        window.location.href = mailtoLink;
    });
    
    // 添加键盘事件监听器实现快捷键功能
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    const fab = document.querySelector('.fab');
    fab.addEventListener('click', () => {
        window.open('http://map.shangxiaoguan.top', '_blank');
    });
});

// 处理键盘快捷键（保持原有函数名以确保向后兼容）
function handleKeyboardShortcuts(event) {
    handleKeyDown(event);
}

// 存储当前按下的键
const keysPressed = new Set();

// 处理键盘按下事件
function handleKeyDown(event) {
    // 检查是否在输入框中，如果在输入框中则不处理快捷键
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'SELECT') {
        return;
    }
    
    // 添加按下的键到集合中
    keysPressed.add(event.key.toLowerCase());
    
    // 处理移动
    processMovement(event);
}

// 处理键盘释放事件
function handleKeyUp(event) {
    // 从集合中移除释放的键
    keysPressed.delete(event.key.toLowerCase());
}

// 处理移动逻辑
function processMovement(event) {
    const xInput = document.getElementById('coordinates-x');
    const zInput = document.getElementById('coordinates-z');
    
    // 确保坐标输入框存在
    if (!xInput || !zInput) return;
    
    let x = parseFloat(xInput.value);
    let z = parseFloat(zInput.value);
    
    // 检查数值是否有效
    if (isNaN(x) || isNaN(z)) return;
    
    // 移动步长
    let step = 10; // 默认步长
    
    // 检查修饰键
    if (event.shiftKey) {
        step = 100; // Shift键按下时步长为100
    } else if (event.altKey) {
        step = 1; // Alt键按下时步长为1
    }
    
    // 检查对角线移动组合
    const isWPressed = keysPressed.has('w');
    const isAPressed = keysPressed.has('a');
    const isSPressed = keysPressed.has('s');
    const isDPressed = keysPressed.has('d');
    const isMinusPressed = keysPressed.has('-') || keysPressed.has('_');
    const isPlusPressed = keysPressed.has('=') || keysPressed.has('+');
    
    // 计算移动方向
    let moved = false;
    
    // 垂直方向
    if (isWPressed && !isSPressed) {
        z -= step;
        moved = true;
    } else if (isSPressed && !isWPressed) {
        z += step;
        moved = true;
    }
    
    // 水平方向
    if (isAPressed && !isDPressed) {
        x -= step;
        moved = true;
    } else if (isDPressed && !isAPressed) {
        x += step;
        moved = true;
    }
    
    // 如果有移动，则更新坐标
    if (moved) {
        // 更新坐标输入框
        xInput.value = x;
        zInput.value = z;
        
        // 标记为手动修改
        isCoordinatesEdited = true;
        
        // 触发更新
        xInput.dispatchEvent(new Event('input'));
        zInput.dispatchEvent(new Event('input'));
        
        // 触发搜索更新
        triggerSearch();
        
        // 阻止默认行为（如页面滚动）
        event.preventDefault();
    }

    if (isPlusPressed) handleZoomIn();
    if (isMinusPressed) handleZoomOut();
}

function updateURLCategory(category) {
    const urlParams = new URLSearchParams(window.location.search);
    if (category) {
        urlParams.set('cat', category);
    } else {
        urlParams.delete('cat');
    }
    const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
    history.pushState(null, '', newUrl);
}

async function savePreviewImage(name) {
    triggerSearch();
    // 将.preview-container的图片下载
    const previewContainer = document.querySelector('.preview-container');
    const pinLabel = document.querySelector('.pin-label');
    const previewFooter = document.querySelector('.preview-footer');
    const locationDistance = document.querySelector('.search-item.selected .search-item-coordinate').textContent.match(/\d+/)[0];
    const zoomControls = document.querySelector('.zoom-controls');
    zoomControls.style.display = 'none'; // 隐藏缩放控件以避免出现在截图中
    
    pinLabel.style.opacity = locationDistance > 0 ? 0 : 1;
    console.log(locationDistance);
    previewFooter.style.display = 'flex';
    
    try {
        // 检查是否有SVG元素
        const hasSvg = previewContainer.querySelector('svg');
        
        if (hasSvg) {
            // 使用canvg处理SVG元素
            const svgs = previewContainer.querySelectorAll('svg');
            const promises = [];
            
            // 为每个SVG创建临时canvas并转换
            svgs.forEach(svg => {
                const originalDisplay = svg.style.display;
                svg.style.display = 'block'; // 确保SVG可见
                
                const bbox = svg.getBBox();
                const width = Math.max(bbox.width || 100, 100);
                const height = Math.max(bbox.height || 100, 100);
                
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.style.position = 'absolute';
                canvas.style.left = svg.style.left || '0';
                canvas.style.top = svg.style.top || '0';
                //canvas.style.transform = svg.style.transform || '';
                canvas.style.zIndex = svg.style.zIndex || '0';
                canvas.style.transformOrigin = svg.style.transformOrigin || 'top left';
                canvas.strokeWidth = svg.style.strokeWidth || 16;
                canvas.style.opacity = 0.6;
                canvas.style.overflow = 'visible';
                canvas.style.zIndex = svg.style.zIndex || '10';
                
                // 使用canvg将SVG渲染到canvas
                const ctx = canvas.getContext('2d');
                const svgString = new XMLSerializer().serializeToString(svg);
                const v = canvg.Canvg.fromString(ctx, svgString);
                promises.push(v.render());
                
                // 替换SVG为canvas（临时）
                svg.parentNode.insertBefore(canvas, svg);
                svg.style.opacity = 0;
            });
            
            // 等待所有SVG渲染完成
            await Promise.all(promises);
        }
        
        const canvas = await html2canvas(previewContainer, {
            backgroundColor: 'transparent',
            lineHeight: 1,
            useCORS: true, // 启用CORS支持以处理跨域图片
            allowTaint: false, // 禁止污染，确保图片能正确加载
            scale: 2, // 提高截图质量
            logging: false // 减少控制台输出
        });
        
        // 恢复SVG元素（如果之前被替换）
        if (hasSvg) {
            const canvases = previewContainer.querySelectorAll('canvas');
            canvases.forEach(canvas => {
                const nextElement = canvas.nextElementSibling;
                if (nextElement && nextElement.tagName === 'SVG') {
                    nextElement.style.display = 'block';
                    canvas.remove();
                }
            });
        }
        
        const imgData = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = imgData;
        link.download = `${name}${locationDistance > 0?'附近':''}卫星图像`;
        link.click();
        
        console.log('图片保存成功');
    } catch (error) {
        console.error('截图保存失败:', error);
        showToast('图片保存失败，请重试', 'error');
    }
        
    // 确保在错误情况下也能恢复SVG
    const canvases = previewContainer.querySelectorAll('canvas');
    canvases.forEach(canvas => {
        const nextElement = canvas.nextElementSibling;
        if (nextElement && nextElement.tagName === 'SVG') {
            nextElement.style.display = 'block';
        }
        canvas.remove();
    });

    previewFooter.style.display = 'none';
    zoomControls.style.display = '';
    
    // 不对map.html执行以下代码
    if (window.location.href.indexOf('map.html') === -1) {
        pinLabel.style.opacity = 0;
    }
}

function openAddPointModal(x,z) {
    const modal = document.getElementById('add-point-modal');
    modal.style.display = 'flex';
    
    // 设置坐标值
    document.getElementById('coordinates-x').value = x;
    document.getElementById('coordinates-z').value = z;
    
    // 设置模态框标题显示坐标
    const modalTitle = document.querySelector('.modal-title');
    modalTitle.textContent = `申请(${x}, ${z})处的标记`;
    
    // 清空之前输入
    document.getElementById('point-name').value = '';
    document.getElementById('point-category').selectedIndex = 0;
}

function closeAddPointModal() {
    const modal = document.getElementById('add-point-modal');
    modal.style.display = 'none';
}

// 保存标记点到localStorage
function saveLocalMarker(marker) {
    let localMarkers = JSON.parse(localStorage.getItem(LOCAL_MARKERS_KEY) || '[]');
    // 检查是否已存在相同的标记点
    const exists = localMarkers.some(m => 
        m.x === marker.x && m.z === marker.z && m.text === marker.text && m.image === marker.image
    );
    
    if (!exists) {
        localMarkers.push(marker);
        localStorage.setItem(LOCAL_MARKERS_KEY, JSON.stringify(localMarkers));
        // 更新搜索结果
        triggerSearch();
        return true;
    }
    return false;
}

// 标记点代码生成函数
function generateMarkerCode(pointName, pointCategory, xCoordinate, zCoordinate) {
    // 查找断行标记"|"并分割为多行文本
    const lines = pointName.split('|');
    // 字数最多的那一行设为textLength及补全空格，并将处理后的文本中的半角字符转换成全角字符
    const textLength = Math.max(...lines.map(line => line.length));
    const paddedText = lines.map(line => {
        let paddedLine = line.padEnd(textLength, '　');
        return paddedLine.replace(/[a-zA-Z0-9]/g, c => String.fromCharCode(c.charCodeAt(0) + 65248));
    }).join('\\n');

    const fontSize = pointCategory === 'bus-stop' ? '12px' : '14px';
    const fontWeight = pointCategory === 'lindong-metro' ? 'bold' : 'normal';
    const offsetX = textLength * (fontSize === '12px' ? 6 : 7) + 10;
    
    // 生成标记点代码
    const markerCode = `        {
            x: ${xCoordinate},
            z: ${zCoordinate},
            image: "${pointCategory}.png",
            imageAnchor: [0.5, 0.5],
            imageScale: 0.2,
            text: "${paddedText}",
            textColor: "white",
            offsetX: ${offsetX},
            offsetY: 1,
            font: "${fontWeight} ${fontSize} Calibri,sans serif",
        },`;
    
    return markerCode;
}

// 从localStorage获取本地标记点
function getLocalMarkers() {
    return JSON.parse(localStorage.getItem(LOCAL_MARKERS_KEY) || '[]');
}

// 从localStorage删除本地标记点
function deleteLocalMarkers(indices) {
    let localMarkers = JSON.parse(localStorage.getItem(LOCAL_MARKERS_KEY) || '[]');
    // 从后往前删除，避免索引变化问题
    indices.sort((a, b) => b - a);
    indices.forEach(index => {
        localMarkers.splice(index, 1);
    });
    localStorage.setItem(LOCAL_MARKERS_KEY, JSON.stringify(localMarkers));
}

// 更新本地标记点
function updateLocalMarker(index, updatedMarker) {
    let localMarkers = JSON.parse(localStorage.getItem(LOCAL_MARKERS_KEY) || '[]');
    if (index >= 0 && index < localMarkers.length) {
        localMarkers[index] = updatedMarker;
        localStorage.setItem(LOCAL_MARKERS_KEY, JSON.stringify(localMarkers));
        return true;
    }
    return false;
}

// 渲染本地标记点列表
function renderLocalMarkersList() {
    const localMarkers = getLocalMarkers();
    const listContainer = document.querySelector('.manage-points-list');
    listContainer.innerHTML = '';
    
    if (localMarkers.length === 0) {
        listContainer.innerHTML = '<p>暂无本地标记点</p>';
        return;
    }
    
    localMarkers.forEach((marker, index) => {
        const category = categoryMap[marker.image.replace(/\.png$/, '')] || '其他';
        const markerElement = document.createElement('div');
        markerElement.className = 'local-marker-item';
        markerElement.innerHTML = `
            <input type="checkbox" data-index="${index}">
            <div class="local-marker-info">
                <div class="local-marker-name">${marker.text}</div>
                <div class="local-marker-coords">${category} (${marker.x}, ${marker.z})</div>
            </div>
            <div class="local-marker-actions">
                <button class="icon-button edit-marker" data-index="${index}" title="编辑">
                    <img src="/UI/res/edit_black.png" alt="编辑">
                </button>
                <button class="icon-button delete-marker" data-index="${index}" title="删除">
                    <img src="/UI/res/delete_black.png" alt="删除">
                </button>
            </div>
        `;
        listContainer.appendChild(markerElement);
    });
    
    // 绑定复选框状态变化事件
    document.querySelectorAll('.manage-points-list input[type="checkbox"]').forEach(checkbox => {
        // 监听复选框状态变化
        checkbox.addEventListener('change', function() {
            const item = this.closest('.local-marker-item');
            if (this.checked) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
            updateToggleAllButton();
        });
    });
    
    // 绑定整个项目点击事件
    document.querySelectorAll('.local-marker-item').forEach(item => {
        item.addEventListener('click', function(e) {
            // 避免点击按钮时触发
            if (e.target.classList.contains('icon-button') || e.target.tagName === 'IMG') {
                return;
            }
            
            const checkbox = this.querySelector('input[type="checkbox"]');
            checkbox.checked = !checkbox.checked;
            
            // 触发change事件以更新样式
            checkbox.dispatchEvent(new Event('change'));
        });
    });
    
    // 绑定编辑和删除按钮事件
    document.querySelectorAll('.edit-marker').forEach(button => {
        button.addEventListener('click', function() {
            const index = parseInt(this.getAttribute('data-index'));
            openEditMarkerModal(index);
        });
    });
    
    document.querySelectorAll('.delete-marker').forEach(button => {
        button.addEventListener('click', function() {
            const index = parseInt(this.getAttribute('data-index'));
            deleteSingleMarker(index);
        });
    });
}

// 更新全选/取消全选按钮的文本
function updateToggleAllButton() {
    const toggleButton = document.getElementById('toggle-all-points');
    const allCheckboxes = document.querySelectorAll('.manage-points-list input[type="checkbox"]');
    const checkedCheckboxes = document.querySelectorAll('.manage-points-list input[type="checkbox"]:checked');
    
    if (allCheckboxes.length === checkedCheckboxes.length && allCheckboxes.length > 0) {
        toggleButton.textContent = '取消全选';
    } else {
        toggleButton.textContent = '全选';
    }
    
    // 检查是否有选中的项目，如果没有则禁用操作按钮
    const actionsContainer = document.querySelector('.manage-points-actions');
    if (checkedCheckboxes.length > 0) {
        actionsContainer.classList.remove('disabled');
    } else {
        actionsContainer.classList.add('disabled');
    }
}

// 切换所有复选框的选中状态
function toggleAllPoints() {
    const allCheckboxes = document.querySelectorAll('.manage-points-list input[type="checkbox"]');
    const checkedCheckboxes = document.querySelectorAll('.manage-points-list input[type="checkbox"]:checked');
    const toggleButton = document.getElementById('toggle-all-points');
    
    // 如果所有项都被选中，或者部分被选中，则取消全选
    const shouldSelectAll = !(allCheckboxes.length === checkedCheckboxes.length && allCheckboxes.length > 0);
    
    allCheckboxes.forEach(checkbox => {
        checkbox.checked = shouldSelectAll;
        const item = checkbox.closest('.local-marker-item');
        if (shouldSelectAll) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
    
    // 更新按钮文本
    toggleButton.textContent = shouldSelectAll ? '取消全选' : '全选';
    
    // 更新操作按钮的显示状态
    updateToggleAllButton();
}

// 打开管理本地标记点模态框
function openManagePointsModal() {
    const modal = document.getElementById('manage-points-modal');
    modal.style.display = 'flex';
    renderLocalMarkersList();
    updateToggleAllButton();
}

// 关闭管理本地标记点模态框
function closeManagePointsModal() {
    const modal = document.getElementById('manage-points-modal');
    modal.style.display = 'none';
}

// 打开编辑标记点模态框
function openEditMarkerModal(index) {
    const localMarkers = getLocalMarkers();
    if (index < 0 || index >= localMarkers.length) return;
    
    const marker = localMarkers[index];
    const modal = document.getElementById('edit-point-modal');

    // 获取标记点坐标
    const posX = marker.x;
    const posZ = marker.z;

    // 更改标题
    modal.querySelector('h3').textContent = `编辑(${posX}, ${posZ})处标记点`;
    
    // 填充表单数据
    document.getElementById('edit-point-index').value = index;
    document.getElementById('edit-point-name').value = marker.text;
    
    // 填充分类选项
    const categorySelect = document.getElementById('edit-point-category');
    categorySelect.innerHTML = '';
    
    // 添加默认选项
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '请选择分类';
    categorySelect.appendChild(defaultOption);
    
    // 添加所有分类选项
    Object.keys(categoryMap).forEach(key => {
        const option = document.createElement('option');
        option.value = key + '.png';
        option.textContent = categoryMap[key];
        if (marker.image === key + '.png') {
            option.selected = true;
        }
        categorySelect.appendChild(option);
    });
    
    modal.style.display = 'flex';
}

// 关闭编辑标记点模态框
function closeEditMarkerModal() {
    const modal = document.getElementById('edit-point-modal');
    modal.style.display = 'none';
}

// 保存编辑的标记点
function saveEditedMarker() {
    const index = document.getElementById('edit-point-index').value;
    const name = document.getElementById('edit-point-name').value.trim();
    const category = document.getElementById('edit-point-category').value;
    
    if (!name) {
        showToast('请输入标记点名称');
        return;
    }
    
    if (!category) {
        showToast('请选择分类');
        return;
    }
    
    const localMarkers = getLocalMarkers();
    if (index < 0 || index >= localMarkers.length) return;
    
    // 更新标记点
    const updatedMarker = {
        ...localMarkers[index],
        text: name,
        image: category
    };
    
    if (updateLocalMarker(parseInt(index), updatedMarker)) {
        showToast('标记点更新成功');
        closeEditMarkerModal();
        renderLocalMarkersList();
        // 更新搜索结果
        triggerSearch();
    } else {
        showToast('标记点更新失败');
    }
}

// 删除单个标记点
function deleteSingleMarker(index) {
    if (confirm('确定要删除这个标记点吗？')) {
        deleteLocalMarkers([index]);
        showToast('标记点已删除');
        renderLocalMarkersList();
        // 更新搜索结果
        triggerSearch();
    }
}
