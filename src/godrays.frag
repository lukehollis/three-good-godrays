/*
 * Code taken from this demo: https://n8python.github.io/goodGodRays/
 * By: https://github.com/n8python
 *
 * With cleanup and minor changes
 */

varying vec2 vUv;

uniform sampler2D sceneDepth;
uniform sampler2D blueNoise;
uniform vec3 lightPos;
uniform vec3 cameraPos;
uniform vec2 resolution;
uniform mat4 lightCameraProjectionMatrix;
uniform mat4 lightCameraMatrixWorldInverse;
uniform mat4 cameraProjectionMatrixInv;
uniform mat4 cameraMatrixWorld;
uniform sampler2D shadowMap;
uniform vec2 noiseResolution;
uniform float mapSize;
uniform float lightCameraNear;
uniform float lightCameraFar;
uniform float density;
uniform float maxDensity;
uniform float distanceAttenuation;

#include <packing>

vec3 WorldPosFromDepth(float depth, vec2 coord) {
  float z = depth * 2.0 - 1.0;
  vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
  vec4 viewSpacePosition = cameraProjectionMatrixInv * clipSpacePosition;
  // Perspective division
  viewSpacePosition /= viewSpacePosition.w;
  vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
  return worldSpacePosition.xyz;
}

float linearize_depth(float d,float zNear,float zFar) {
  return zNear * zFar / (zFar + d * (zNear - zFar));
}

/**
 * Converts angle between light and a world position to a coordinate
 * in a point light cube shadow map
 */
vec2 cubeToUV( vec3 v, float texelSizeY ) {
  // Number of texels to avoid at the edge of each square
  vec3 absV = abs( v );
  // Intersect unit cube
  float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
  absV *= scaleToCube;
  // Apply scale to avoid seams
  // two texels less per square (one texel will do for NEAREST)
  v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
  // Unwrap
  // space: -1 ... 1 range for each square
  //
  // #X##        dim    := ( 4 , 2 )
  //  # #        center := ( 1 , 1 )
  vec2 planar = v.xy;
  float almostATexel = 1.5 * texelSizeY;
  float almostOne = 1.0 - almostATexel;
  if ( absV.z >= almostOne ) {
    if ( v.z > 0.0 )
      planar.x = 4.0 - v.x;
  } else if ( absV.x >= almostOne ) {
    float signX = sign( v.x );
    planar.x = v.z * signX + 2.0 * signX;
  } else if ( absV.y >= almostOne ) {
    float signY = sign( v.y );
    planar.x = v.x + 2.0 * signY + 2.0;
    planar.y = v.z * signY - 2.0;
  }
  // Transform to UV space
  // scale := 0.5 / dim
  // translate := ( center + 0.5 ) / dim
  return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
}

/**
 * Projects `worldPos` onto the shadow map of a directional light and returns
 * that position in UV space.
 */
vec3 projectToShadowMap(vec3 worldPos) {
  vec4 lightSpacePos = lightCameraProjectionMatrix * lightCameraMatrixWorldInverse * vec4(worldPos, 1.0);
  lightSpacePos /= lightSpacePos.w;
  lightSpacePos = lightSpacePos * 0.5 + 0.5;
  return lightSpacePos.xyz;
}

vec2 inShadow(vec3 worldPos) {
  #if defined(IS_POINT_LIGHT)
    float texelSizeY = 1.0 / (mapSize * 2.0);
    vec2 shadowMapUV = cubeToUV(normalize(worldPos - lightPos), texelSizeY);
  #elif defined(IS_DIRECTIONAL_LIGHT)
    vec3 shadowMapUV = projectToShadowMap(worldPos);
    if (shadowMapUV.x < 0.0 || shadowMapUV.x > 1.0 || shadowMapUV.y < 0.0 || shadowMapUV.y > 1.0 || shadowMapUV.z < 0.0 || shadowMapUV.z > 1.0) {
      return vec2(1.0, 0.0);
    }
  #endif

  vec4 packedDepth = texture2D(shadowMap, shadowMapUV.xy);
  float depth = unpackRGBAToDepth(packedDepth);
  depth = lightCameraNear + (lightCameraFar - lightCameraNear) * depth;
  #if defined(IS_POINT_LIGHT)
    float lightDist = distance(worldPos, lightPos);
  #elif defined(IS_DIRECTIONAL_LIGHT)
    float lightDist = (lightCameraNear + (lightCameraFar - lightCameraNear) * shadowMapUV.z);
  #endif
  #if defined(IS_POINT_LIGHT)
      float difference = lightDist - depth;
  #elif defined(IS_DIRECTIONAL_LIGHT)
      float difference = lightDist - depth;
  #endif
  return vec2(float(difference > 0.01), lightDist);
}

void main() {
  float depth = texture2D(sceneDepth, vUv).x;
  // if (depth == 1.) {
  //   gl_FragColor = vec4(0.0, 1., 0., 1.);
  //   return;
  // }

  vec3 worldPos = WorldPosFromDepth(depth, vUv);
  // vec2 tempUV = projectToShadowMap(worldPos);
  // if (tempUV.x < 0.0 || tempUV.x > 1.0 || tempUV.y < 0.0 || tempUV.y > 1.0) {
  //   gl_FragColor = vec4(0.0);
  //   return;
  // }
  // gl_FragColor = vec4(tempUV, 0.0, 1.0);
  // return;
  float illum = 0.0;

  vec4 blueNoiseSample = texture2D(blueNoise, vUv * (resolution / noiseResolution));
  float samples = round(60.0 + 8.0 * blueNoiseSample.x);
  for (float i = 0.0; i < samples; i++) {
    vec3 samplePos = mix(cameraPos, worldPos, i / samples);
    vec2 shadowInfo = inShadow(samplePos);
    float shadowAmount = (1.0 - shadowInfo.x);
    illum += shadowAmount * (distance(cameraPos, worldPos) * density) * exp(-distanceAttenuation * shadowInfo.y);
  }
  illum /= samples;
  gl_FragColor = vec4(vec3(clamp((1.0 - exp(-illum)), 0.0, maxDensity)), depth);
}
