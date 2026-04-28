"use client";

import { useEffect, useRef } from "react";
import { useNavigation } from "@/components/navigation/TopNav";
import { MAIN_NAV_ITEMS } from "@/lib/nav-items";

export function useSwipeNavigation(elementRef?: React.RefObject<HTMLElement>) {
  const { activeTab, setActiveTab } = useNavigation();
  const startX = useRef<number | null>(null);
  const endX = useRef<number | null>(null);
  const isDragging = useRef(false);

  const minSwipeDistance = 50;

  const handleStart = (clientX: number) => {
    isDragging.current = true;
    endX.current = null;
    startX.current = clientX;
  };

  const handleMove = (clientX: number) => {
    if (isDragging.current) {
      endX.current = clientX;
    }
  };

  const handleEnd = () => {
    if (!isDragging.current || !startX.current || !endX.current) {
      isDragging.current = false;
      return;
    }

    const distance = startX.current - endX.current;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe || isRightSwipe) {
      const currentIndex = MAIN_NAV_ITEMS.findIndex((item) => item.id === activeTab);

      if (currentIndex >= 0) {
        if (isLeftSwipe && currentIndex < MAIN_NAV_ITEMS.length - 1) {
          setActiveTab(MAIN_NAV_ITEMS[currentIndex + 1].id);
        } else if (isRightSwipe && currentIndex > 0) {
          setActiveTab(MAIN_NAV_ITEMS[currentIndex - 1].id);
        }
      }
    }

    isDragging.current = false;
  };

  const onTouchStart = (e: TouchEvent) => {
    handleStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: TouchEvent) => {
    handleMove(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    handleEnd();
  };

  const onMouseDown = (e: MouseEvent) => {
    handleStart(e.clientX);
  };

  const onMouseMove = (e: MouseEvent) => {
    handleMove(e.clientX);
  };

  const onMouseUp = () => {
    handleEnd();
  };

  useEffect(() => {
    const element = elementRef?.current || document.body;
    
    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: true });
    element.addEventListener("touchend", onTouchEnd, { passive: true });
    
    element.addEventListener("mousedown", onMouseDown);
    element.addEventListener("mousemove", onMouseMove);
    element.addEventListener("mouseup", onMouseUp);

    return () => {
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("mousedown", onMouseDown);
      element.removeEventListener("mousemove", onMouseMove);
      element.removeEventListener("mouseup", onMouseUp);
    };
  }, [activeTab, setActiveTab, elementRef]);
}
