import React, { useContext } from 'react';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
  type SharedValue,
  type WithDecayConfig,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { clamp } from '../../commons/utils/clamp';
import { pinchTransform } from '../../commons/utils/pinchTransform';
import { useVector } from '../../commons/hooks/useVector';
import { snapPoint } from '../../commons/utils/snapPoint';
import { crop } from '../../commons/utils/crop';
import { usePinchCommons } from '../../commons/hooks/usePinchCommons';
import { getSwipeDirection } from '../../commons/utils/getSwipeDirection';

import { GalleryContext } from './context';
import { type GalleryProps } from './types';
import {
  PinchCenteringMode,
  ScaleMode,
  SwipeDirection,
  type BoundsFuction,
  type PanGestureEvent,
} from '../../commons/types';

const minScale = 1;
const config = { duration: 300, easing: Easing.linear };

type ReflectionProps = {
  length: number;
  maxScale: SharedValue<number>;
  itemSize: Readonly<SharedValue<number>>;
  vertical: boolean;
  tapOnEdgeToItem: boolean;
  allowPinchPanning: boolean;
  pinchCenteringMode: PinchCenteringMode;
  onTap?: GalleryProps['onTap'];
  onPanStart?: GalleryProps['onPanStart'];
  onPanEnd?: GalleryProps['onPanEnd'];
  onPinchStart?: GalleryProps['onPinchStart'];
  onPinchEnd?: GalleryProps['onPinchEnd'];
  onSwipe?: GalleryProps['onSwipe'];
  onVerticalPull?: GalleryProps['onVerticalPull'];
};

/*
 * Pinchable views are really heavy components, therefore in order to maximize performance
 * only a single pinchable view is shared among all the list items, items listen to this
 * component updates and only update themselves if they are the current item.
 */
const Reflection = ({
  length,
  maxScale,
  itemSize,
  vertical,
  tapOnEdgeToItem,
  allowPinchPanning,
  pinchCenteringMode,
  onTap,
  onPanStart,
  onPanEnd,
  onPinchStart: onUserPinchStart,
  onPinchEnd: onUserPinchEnd,
  onSwipe: onUserSwipe,
  onVerticalPull,
}: ReflectionProps) => {
  const {
    activeIndex,
    fetchIndex,
    scroll,
    scrollOffset,
    isScrolling,
    rootSize,
    rootChildSize,
    translate,
    scale,
  } = useContext(GalleryContext);

  const offset = useVector(0, 0);
  const origin = useVector(0, 0);
  const delta = useVector(0, 0);
  const scaleOffset = useSharedValue<number>(1);

  const detectorTranslate = useVector(0, 0);
  const detectorScale = useSharedValue<number>(1);

  const time = useSharedValue<number>(0);
  const position = useVector(0, 0);

  const isPullingVertical = useSharedValue<boolean>(false);
  const pullReleased = useSharedValue<boolean>(false);

  const boundsFn: BoundsFuction = (scaleValue) => {
    'worklet';

    const { width: cWidth, height: cHeight } = rootChildSize;
    const { width: rWidth, height: rHeight } = rootSize;

    const boundX = Math.max(0, cWidth.value * scaleValue - rWidth.value) / 2;
    const boundY = Math.max(0, cHeight.value * scaleValue - rHeight.value) / 2;
    return { x: boundX, y: boundY };
  };

  const reset = (
    toX: number,
    toY: number,
    toScale: number,
    animate: boolean = true
  ) => {
    'worklet';

    detectorTranslate.x.value = translate.x.value;
    detectorTranslate.y.value = translate.y.value;
    detectorScale.value = scale.value;

    translate.x.value = animate ? withTiming(toX) : toX;
    translate.y.value = animate ? withTiming(toY) : toY;
    scale.value = animate ? withTiming(toScale) : toScale;
    detectorTranslate.x.value = animate ? withTiming(toX) : toX;
    detectorTranslate.y.value = animate ? withTiming(toY) : toY;
    detectorScale.value = animate ? withTiming(toScale) : toScale;
  };

  const snapToScrollPosition = (e: PanGestureEvent) => {
    'worklet';
    const index = activeIndex.value;
    const prev = itemSize.value * clamp(index - 1, 0, length - 1);
    const current = itemSize.value * index;
    const next = itemSize.value * clamp(index + 1, 0, length - 1);

    const velocity = vertical ? e.velocityY : e.velocityX;
    const toScroll = snapPoint(scroll.value, velocity, [prev, current, next]);

    if (toScroll !== current)
      fetchIndex.value = index + (toScroll === next ? 1 : -1);

    scroll.value = withTiming(toScroll, config, () => {
      activeIndex.value = fetchIndex.value;
      isScrolling.value = false;
      toScroll !== current && reset(0, 0, minScale, false);
    });
  };

  const onSwipe = (direction: SwipeDirection) => {
    'worklet';

    let toIndex = activeIndex.value;
    if (direction === SwipeDirection.UP && vertical) toIndex += 1;
    if (direction === SwipeDirection.DOWN && vertical) toIndex -= 1;
    if (direction === SwipeDirection.LEFT && !vertical) toIndex += 1;
    if (direction === SwipeDirection.RIGHT && !vertical) toIndex -= 1;

    toIndex = clamp(toIndex, 0, length - 1);
    if (toIndex === activeIndex.value) return;

    fetchIndex.value = toIndex;
    scroll.value = withTiming(toIndex * itemSize.value, config, () => {
      activeIndex.value = toIndex;
      isScrolling.value = false;
      reset(0, 0, minScale, false);
    });
  };

  useAnimatedReaction(
    () => ({
      translate: translate.y.value,
      scale: scale.value,
      isPulling: isPullingVertical.value,
      released: pullReleased.value,
    }),
    (val) => {
      const shouldPull = !vertical && val.scale === 1 && val.isPulling;
      shouldPull && onVerticalPull?.(val.translate, val.released);
    },
    [translate, scale, isPullingVertical, pullReleased]
  );

  useAnimatedReaction(
    () => ({
      width: rootSize.width.value,
      height: rootSize.height.value,
    }),
    () => reset(0, 0, minScale, false),
    [rootSize]
  );

  const { gesturesEnabled, onPinchStart, onPinchUpdate, onPinchEnd } =
    usePinchCommons({
      container: rootSize,
      detectorTranslate,
      detectorScale,
      translate,
      offset,
      origin,
      scale,
      scaleOffset,
      minScale,
      maxScale,
      delta,
      allowPinchPanning,
      scaleMode: ScaleMode.BOUNCE,
      pinchCenteringMode,
      boundFn: boundsFn,
      userCallbacks: {
        onPinchStart: onUserPinchStart,
        onPinchEnd: onUserPinchEnd,
      },
    });

  const pinch = Gesture.Pinch()
    .onStart(onPinchStart)
    .onUpdate(onPinchUpdate)
    .onEnd(onPinchEnd);

  const pan = Gesture.Pan()
    .maxPointers(1)
    .enabled(gesturesEnabled)
    .onStart((e) => {
      onPanStart && runOnJS(onPanStart)(e);
      cancelAnimation(translate.x);
      cancelAnimation(translate.y);
      cancelAnimation(detectorTranslate.x);
      cancelAnimation(detectorTranslate.y);

      const isVerticalPan = Math.abs(e.velocityY) > Math.abs(e.velocityX);
      isPullingVertical.value = isVerticalPan && scale.value === 1 && !vertical;
      isScrolling.value = true;

      time.value = performance.now();
      position.x.value = e.absoluteX;
      position.y.value = e.absoluteY;

      scrollOffset.value = scroll.value;
      offset.x.value = translate.x.value;
      offset.y.value = translate.y.value;
    })
    .onUpdate((e) => {
      if (isPullingVertical.value) {
        translate.y.value = e.translationY;
        return;
      }

      const toX = offset.x.value + e.translationX;
      const toY = offset.y.value + e.translationY;

      const { x: boundX, y: boundY } = boundsFn(scale.value);
      const exceedX = Math.max(0, Math.abs(toX) - boundX);
      const exceedY = Math.max(0, Math.abs(toY) - boundY);

      const scrollX = -1 * Math.sign(toX) * exceedX;
      const scrollY = -1 * Math.sign(toY) * exceedY;
      scroll.value = clamp(
        scrollOffset.value + (vertical ? scrollY : scrollX),
        0,
        (length - 1) * itemSize.value
      );

      translate.x.value = clamp(toX, -1 * boundX, boundX);
      translate.y.value = clamp(toY, -1 * boundY, boundY);
      detectorTranslate.x.value = clamp(toX, -1 * boundX, boundX);
      detectorTranslate.y.value = clamp(toY, -1 * boundY, boundY);
    })
    .onEnd((e) => {
      const bounds = boundsFn(scale.value);
      const direction = getSwipeDirection(e, {
        boundaries: bounds,
        time: time.value,
        position: { x: position.x.value, y: position.y.value },
        translate: {
          x: isPullingVertical.value ? 100 : translate.x.value,
          y: isPullingVertical.value ? 0 : translate.y.value,
        },
      });

      direction !== undefined && onSwipe(direction);
      direction !== undefined && onUserSwipe && runOnJS(onUserSwipe)(direction);

      if (isPullingVertical.value) {
        pullReleased.value = true;
        translate.y.value = withTiming(0, undefined, (finished) => {
          isPullingVertical.value = !finished;
          pullReleased.value = !finished;
        });

        return;
      }

      const isSwipingH =
        direction === SwipeDirection.LEFT || direction === SwipeDirection.RIGHT;

      const isSwipingV =
        direction === SwipeDirection.UP || direction === SwipeDirection.DOWN;

      const snapV = vertical && (direction === undefined || isSwipingH);
      const snapH = !vertical && (direction === undefined || isSwipingV);

      onPanEnd && runOnJS(onPanEnd)(e);
      (snapV || snapH) && snapToScrollPosition(e);

      const configX = { velocity: e.velocityX, clamp: [-bounds.x, bounds.x] };
      const configY = { velocity: e.velocityY, clamp: [-bounds.y, bounds.y] };

      translate.x.value = withDecay(configX as WithDecayConfig);
      translate.y.value = withDecay(configY as WithDecayConfig);
      detectorTranslate.x.value = withDecay(configX as WithDecayConfig);
      detectorTranslate.y.value = withDecay(configY as WithDecayConfig);
    });

  const tap = Gesture.Tap()
    .enabled(gesturesEnabled)
    .numberOfTaps(1)
    .maxDuration(250)
    .onEnd((e) => {
      const gallerySize = {
        width: rootSize.width.value,
        height: rootSize.height.value,
      };

      const { crop: result } = crop({
        scale: scale.value,
        context: {
          flipHorizontal: false,
          flipVertical: false,
          rotationAngle: 0,
        },
        canvas: gallerySize,
        cropSize: gallerySize,
        resolution: gallerySize,
        position: { x: translate.x.value, y: translate.y.value },
      });

      const tapEdge = 44 / scale.value;
      const leftEdge = result.originX + tapEdge;
      const rightEdge = result.originX + result.width - tapEdge;

      let toIndex = activeIndex.value;
      const canGoToItem = tapOnEdgeToItem && !vertical;
      if (e.x <= leftEdge && canGoToItem) toIndex -= 1;
      if (e.x >= rightEdge && canGoToItem) toIndex += 1;

      if (toIndex === activeIndex.value && onTap) {
        runOnJS(onTap)(e, activeIndex.value);
        return;
      }

      toIndex = clamp(toIndex, 0, length - 1);
      scroll.value = toIndex * itemSize.value;
      activeIndex.value = toIndex;
      fetchIndex.value = toIndex;

      reset(0, 0, minScale, false);
    });

  const doubleTap = Gesture.Tap()
    .enabled(gesturesEnabled)
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((e) => {
      const originX = e.x - rootSize.width.value / 2;
      const originY = e.y - rootSize.height.value / 2;
      const toScale =
        scale.value >= maxScale.value * 0.8 ? minScale : maxScale.value;

      const { x, y } = pinchTransform({
        toScale: toScale,
        fromScale: scale.value,
        origin: { x: originX, y: originY },
        delta: { x: 0, y: 0 },
        offset: { x: translate.x.value, y: translate.y.value },
      });

      const { x: boundX, y: boundY } = boundsFn(toScale);
      const toX = clamp(x, -1 * boundX, boundX);
      const toY = clamp(y, -1 * boundY, boundY);
      reset(toX, toY, toScale);
    });

  const detectorStyle = useAnimatedStyle(() => ({
    width: Math.max(rootSize.width.value, rootChildSize.width.value),
    height: Math.max(rootSize.height.value, rootChildSize.height.value),
    position: 'absolute',
    zIndex: Number.MAX_SAFE_INTEGER,
    transform: [
      { translateX: detectorTranslate.x.value },
      { translateY: detectorTranslate.y.value },
      { scale: detectorScale.value },
    ],
  }));

  const composed = Gesture.Race(pan, pinch, Gesture.Exclusive(doubleTap, tap));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={detectorStyle} />
    </GestureDetector>
  );
};

export default React.memo(Reflection, (prev, next) => {
  return (
    prev.onTap === next.onTap &&
    prev.onPanStart === next.onPanStart &&
    prev.onPanEnd === next.onPanEnd &&
    prev.onPinchStart === next.onPinchStart &&
    prev.onPinchEnd === next.onPinchEnd &&
    prev.onSwipe === next.onSwipe &&
    prev.length === next.length &&
    prev.vertical === next.vertical &&
    prev.tapOnEdgeToItem === next.tapOnEdgeToItem &&
    prev.allowPinchPanning === next.allowPinchPanning &&
    prev.pinchCenteringMode === next.pinchCenteringMode &&
    prev.onVerticalPull === next.onVerticalPull
  );
});
