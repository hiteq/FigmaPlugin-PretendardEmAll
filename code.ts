console.clear();

const fontName = 'Pretendard Variable';

let currentNotification: NotificationHandler | null = null;

function showNotification(message: string, options?: NotificationOptions) {
  // 이전 알림이 있으면 취소
  if (currentNotification) {
    currentNotification.cancel();
  }
  
  // 새 알림 표시
  currentNotification = figma.notify(message, options);
}

// 선택된 레이어 내 텍스트 노드를 스캔하여 사용 중인 폰트 정보 수집
const collectUsedFonts = async (selectedNodes: readonly SceneNode[]): Promise<{family: string, styles: Set<string>}[]> => {
  showNotification(`Scanning used fonts...`);
  
  // 선택된 레이어 내 텍스트 노드 찾기
  const textNodes = selectedNodes.flatMap(node => {
    if (node.type === 'TEXT') {
      return [node as TextNode];
    } else if ('findAll' in node) {
      return node.findAll((n: SceneNode) => n.type === 'TEXT') as TextNode[];
    }
    return [];
  });
  
  // 사용 중인 폰트 정보 수집
  const fontMap = new Map<string, Set<string>>();
  
  for (const textNode of textNodes) {
    try {
      if (textNode.fontWeight === figma.mixed || textNode.fontName === figma.mixed) {
        // Mixed 폰트 처리 - 각 문자별로 폰트 정보 추출
        for (let i = 0; i < textNode.characters.length; i++) {
          const font = textNode.getRangeFontName(i, i+1);
          if (typeof font !== 'symbol' && font.family) {
            if (!fontMap.has(font.family)) {
              fontMap.set(font.family, new Set<string>());
            }
            fontMap.get(font.family)?.add(font.style);
          }
        }
      } else {
        // 단일 폰트 처리
        const font = textNode.fontName;
        if (typeof font !== 'symbol' && font.family) {
          if (!fontMap.has(font.family)) {
            fontMap.set(font.family, new Set<string>());
          }
          fontMap.get(font.family)?.add(font.style);
        }
      }
    } catch (error) {
      console.log(`Error collecting font from node ${textNode.id}:`, error);
    }
  }
  
  // Map을 배열로 변환
  const usedFonts = Array.from(fontMap.entries()).map(([family, styles]) => ({
    family,
    styles: new Set(styles)
  }));
  
  console.log(`Collected ${usedFonts.length} font families from ${textNodes.length} text nodes`);
  return usedFonts;
};

// 수집된 폰트들을 동적으로 로드
const loadCollectedFonts = async (usedFonts: {family: string, styles: Set<string>}[]) => {
  showNotification(`Loading collected fonts...`);
  
  const fontLoadPromises = [];
  for (const font of usedFonts) {
    for (const style of font.styles) {
      fontLoadPromises.push(
        figma.loadFontAsync({ family: font.family, style })
          .catch(err => {
            // 로그만 출력하고 계속 진행
            console.log(`Failed to load font: ${font.family} ${style}`, err.message);
            return null;
          })
      );
    }
  }

  await Promise.all(fontLoadPromises);
  console.log('Collected fonts loading attempted');
};

// 이미 로딩된 폰트를 추적하기 위한 캐시
const loadedFontsCache = new Set<string>();

// 동적으로 폰트 로드 (캐싱 적용)
async function loadFontIfNeeded(font: FontName): Promise<void> {
  if (typeof font !== 'symbol' && font.family) {
    const fontKey = `${font.family}|${font.style}`;
    if (loadedFontsCache.has(fontKey)) {
      return; // 이미 로딩된 폰트는 건너뜀
    }
    
    try {
      await figma.loadFontAsync(font);
      loadedFontsCache.add(fontKey); // 성공적으로 로딩되면 캐시에 추가
    } catch (error: any) {
      console.log(`Failed to load font ${font.family} ${font.style}:`, error.message);
    }
  }
}

let processedCount = 0;
let totalCount = 0;
let lastNotifiedPercentage = -1;

async function processTextNode(textNode: TextNode, index: number, textNodes: TextNode[]): Promise<boolean> {
  try {
    // 진행 상황 업데이트 (5% 단위로 표시)
    processedCount = index + 1;
    totalCount = textNodes.length;
    
    const currentPercentage = Math.floor((processedCount / totalCount) * 100);
    const shouldNotify = currentPercentage >= lastNotifiedPercentage + 5 || processedCount === totalCount;
    
    if (shouldNotify) {
      lastNotifiedPercentage = currentPercentage;
      const timeout = processedCount === totalCount ? 5000 : 2000;
      showNotification(`Processing ${processedCount}/${totalCount} text layers... (${currentPercentage}%)`, { timeout });
    }
    
    // 변경 대상 정보 로깅
    console.log(`Processing text node ${textNode.id}: "${textNode.characters.substring(0, 50)}${textNode.characters.length > 50 ? '...' : ''}"`);
    
    // 폰트 로드 없이 바로 Pretendard Variable로 변경
    if (textNode.fontWeight === figma.mixed || textNode.fontName === figma.mixed) {
      // Mixed 폰트 처리 - 각 문자별로 fontWeight 추출
      console.log(`  → Mixed font detected in node ${textNode.id}`);
      let changedCount = 0;
      
      for (let i = 0; i < textNode.characters.length; i++) {
        const originalFont = textNode.getRangeFontName(i, i+1);
        const charWeight = Number(textNode.getRangeFontWeight(i, i+1));
        const newStyle = getFontStyle(charWeight);
        
        // 필요한 폰트들 동적으로 로드
        const loadPromises = [];
        if (typeof originalFont !== 'symbol') {
          loadPromises.push(loadFontIfNeeded(originalFont));
        }
        loadPromises.push(loadPretendardStyle(newStyle));
        await Promise.all(loadPromises);
        
        // 원본 폰트 정보 로깅
        if (typeof originalFont !== 'symbol' && originalFont.family) {
          console.log(`    Character ${i}: ${originalFont.family} ${originalFont.style} (${charWeight}) → ${fontName} ${newStyle}`);
        }
        
        textNode.setRangeFontName(i, i+1, { family: fontName, style: newStyle });
        changedCount++;
      }
      console.log(`  → Changed ${changedCount} characters in mixed font node ${textNode.id}`);
    } else {
      // 단일 폰트 처리 - 전체 텍스트의 fontWeight 사용
      const originalFont = textNode.fontName;
      const cssWeight = Number(textNode.fontWeight);
      const newStyle = getFontStyle(cssWeight);
      
      // 필요한 폰트들 동적으로 로드
      const loadPromises = [];
      if (typeof originalFont !== 'symbol') {
        loadPromises.push(loadFontIfNeeded(originalFont));
      }
      loadPromises.push(loadPretendardStyle(newStyle));
      await Promise.all(loadPromises);
      
      // 원본 폰트 정보 로깅
      if (typeof originalFont !== 'symbol' && originalFont.family) {
        console.log(`  → Single font: ${originalFont.family} ${originalFont.style} (${cssWeight}) → ${fontName} ${newStyle}`);
      }
      
      textNode.fontName = { family: fontName, style: newStyle };
      console.log(`  → Successfully changed font in node ${textNode.id}`);
    }
    return true;
  } catch (error) {
    console.error(`Error processing text node: ${textNode.id}`, error);
    return false;
  }
}

collectUsedFonts(figma.currentPage.selection)
  .then(async (usedFonts) => {
    await loadCollectedFonts(usedFonts);
    showNotification(`Fonts loaded.`)
    figma.notify(`Changing text in selected layers to ${fontName}.`, { timeout: 500})

    const selectedNodes = figma.currentPage.selection;
    if (selectedNodes.length === 0) {
      figma.closePlugin(`❌ No layers selected. Please select at least one layer and try again.`);
      return;
    }
    const textNodes = selectedNodes.flatMap(node => {
      if (node.type === 'TEXT') {
        return [node as TextNode];
      } else if ('findAll' in node) {
        return node.findAll((n: SceneNode) => n.type === 'TEXT') as TextNode[];
      }
      return [];
    });

    if (textNodes.length === 0) {
      console.log(`No text nodes found in the selected layers.`)
      figma.closePlugin(`❌ No text nodes found in the selected layers. Please select layers with text and try again.`);
      return;
    }
    showNotification(`Processing ${textNodes.length} text layers...`, { timeout: 500 })

    const results = [];
    for (let i = 0; i < textNodes.length; i++) {
      const result = await processTextNode(textNodes[i], i, textNodes);
      results.push(result);
    }
    const count = results.filter(Boolean).length;
    console.log(`All done. Processed ${count} nodes.`);
    figma.closePlugin(`✅ ${count} text layers have been updated.`)
  })
  .catch((error: any) => {
    console.error(`Failed to load fonts:`, error)
    figma.closePlugin(`❌ Failed to load fonts. Please check if ${fontName} is installed and try again.`)
  })

// CSS font-weight를 Pretendard Variable 스타일로 매핑
function getFontStyle(cssWeight: number): string {
  // 100-900까지 100단위로 매핑
  if (cssWeight <= 100) return 'Thin';
  if (cssWeight <= 200) return 'ExtraLight';
  if (cssWeight <= 300) return 'Light';
  if (cssWeight <= 400) return 'Regular';
  if (cssWeight <= 500) return 'Medium';
  if (cssWeight <= 600) return 'SemiBold';
  if (cssWeight <= 700) return 'Bold';
  if (cssWeight <= 800) return 'ExtraBold';
  return 'Black';
}

// Pretendard Variable 스타일 로딩을 위한 캐시
const loadedPretendardStyles = new Set<string>();

// Pretendard Variable 스타일을 동적으로 로드 (캐싱 적용)
async function loadPretendardStyle(style: string): Promise<void> {
  if (loadedPretendardStyles.has(style)) {
    return; // 이미 로딩된 스타일은 건너뜀
  }
  
  try {
    await figma.loadFontAsync({ family: 'Pretendard Variable', style });
    loadedPretendardStyles.add(style); // 성공적으로 로딩되면 캐시에 추가
  } catch (error: any) {
    console.log(`Failed to load Pretendard Variable ${style}:`, error.message);
  }
}
