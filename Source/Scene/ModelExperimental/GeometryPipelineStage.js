import AttributeType from "../AttributeType.js";
import ComponentDatatype from "../../Core/ComponentDatatype.js";
import defined from "../../Core/defined.js";
import GeometryStageFS from "../../Shaders/ModelExperimental/GeometryStageFS.js";
import GeometryStageVS from "../../Shaders/ModelExperimental/GeometryStageVS.js";
import ModelExperimentalUtility from "./ModelExperimentalUtility.js";
import ModelExperimentalType from "./ModelExperimentalType.js";
import PrimitiveType from "../../Core/PrimitiveType.js";
import SceneMode from "../SceneMode.js";
import SelectedFeatureIdPipelineStage from "./SelectedFeatureIdPipelineStage.js";
import ShaderDestination from "../../Renderer/ShaderDestination.js";
import VertexAttributeSemantic from "../VertexAttributeSemantic.js";

/**
 * The geometry pipeline stage processes the vertex attributes of a primitive.
 *
 * @namespace GeometryPipelineStage
 *
 * @private
 */
const GeometryPipelineStage = {};
GeometryPipelineStage.name = "GeometryPipelineStage"; // Helps with debugging

GeometryPipelineStage.STRUCT_ID_PROCESSED_ATTRIBUTES_VS =
  "ProcessedAttributesVS";
GeometryPipelineStage.STRUCT_ID_PROCESSED_ATTRIBUTES_FS =
  "ProcessedAttributesFS";
GeometryPipelineStage.STRUCT_NAME_PROCESSED_ATTRIBUTES = "ProcessedAttributes";
GeometryPipelineStage.FUNCTION_ID_INITIALIZE_ATTRIBUTES =
  "initializeAttributes";
GeometryPipelineStage.FUNCTION_SIGNATURE_INITIALIZE_ATTRIBUTES =
  "void initializeAttributes(out ProcessedAttributes attributes)";
GeometryPipelineStage.FUNCTION_ID_SET_DYNAMIC_VARYINGS_VS =
  "setDynamicVaryingsVS";
GeometryPipelineStage.FUNCTION_ID_SET_DYNAMIC_VARYINGS_FS =
  "setDynamicVaryingsFS";
GeometryPipelineStage.FUNCTION_SIGNATURE_SET_DYNAMIC_VARYINGS =
  "void setDynamicVaryings(inout ProcessedAttributes attributes)";

/**
 * This pipeline stage processes the vertex attributes of a primitive, adding the attribute declarations to the shaders,
 * the attribute objects to the render resources and setting the flags as needed.
 *
 * Processes a primitive. This stage modifies the following parts of the render resources:
 * <ul>
 *  <li> adds attribute and varying declarations for the vertex attributes in the vertex and fragment shaders
 *  <li> creates the objects required to create VertexArrays
 *  <li> sets the flag for point primitive types
 * </ul>
 *
 * If the scene is not 3D only, this stage also:
 * <ul>
 *  <li> adds an attribute for the 2D positions
 * </ul>
 *
 * @param {PrimitiveRenderResources} renderResources The render resources for this primitive.
 * @param {ModelComponents.Primitive} primitive The primitive.
 * @param {FrameState} frameState The frame state.
 *
 * @private
 */
GeometryPipelineStage.process = function (
  renderResources,
  primitive,
  frameState
) {
  const shaderBuilder = renderResources.shaderBuilder;
  // These structs are similar, though the fragment shader version has a couple
  // additional fields.
  shaderBuilder.addStruct(
    GeometryPipelineStage.STRUCT_ID_PROCESSED_ATTRIBUTES_VS,
    "ProcessedAttributes",
    ShaderDestination.VERTEX
  );
  shaderBuilder.addStruct(
    GeometryPipelineStage.STRUCT_ID_PROCESSED_ATTRIBUTES_FS,
    "ProcessedAttributes",
    ShaderDestination.FRAGMENT
  );

  // The Feature struct is always added since it's required for compilation. It may be unused if features are not present.
  shaderBuilder.addStruct(
    SelectedFeatureIdPipelineStage.STRUCT_ID_SELECTED_FEATURE,
    SelectedFeatureIdPipelineStage.STRUCT_NAME_SELECTED_FEATURE,
    ShaderDestination.BOTH
  );

  // This initialization function is only needed in the vertex shader,
  // it assigns the non-quantized attribute struct fields from the
  // physical attributes
  shaderBuilder.addFunction(
    GeometryPipelineStage.FUNCTION_ID_INITIALIZE_ATTRIBUTES,
    GeometryPipelineStage.FUNCTION_SIGNATURE_INITIALIZE_ATTRIBUTES,
    ShaderDestination.VERTEX
  );

  // Positions in other coordinate systems need more variables
  shaderBuilder.addVarying("vec3", "v_positionWC");
  shaderBuilder.addVarying("vec3", "v_positionEC");
  shaderBuilder.addStructField(
    GeometryPipelineStage.STRUCT_ID_PROCESSED_ATTRIBUTES_FS,
    "vec3",
    "positionWC"
  );
  shaderBuilder.addStructField(
    GeometryPipelineStage.STRUCT_ID_PROCESSED_ATTRIBUTES_FS,
    "vec3",
    "positionEC"
  );

  // Though they have identical signatures, the implementation is different
  // between vertex and fragment shaders. The VS stores attributes in
  // varyings, while the FS unpacks the varyings for use by other stages.
  shaderBuilder.addFunction(
    GeometryPipelineStage.FUNCTION_ID_SET_DYNAMIC_VARYINGS_VS,
    GeometryPipelineStage.FUNCTION_SIGNATURE_SET_DYNAMIC_VARYINGS,
    ShaderDestination.VERTEX
  );
  shaderBuilder.addFunction(
    GeometryPipelineStage.FUNCTION_ID_SET_DYNAMIC_VARYINGS_FS,
    GeometryPipelineStage.FUNCTION_SIGNATURE_SET_DYNAMIC_VARYINGS,
    ShaderDestination.FRAGMENT
  );

  // .pnts point clouds store sRGB color rather than linear color
  const model = renderResources.model;
  const modelType = model.type;
  if (modelType === ModelExperimentalType.TILE_PNTS) {
    shaderBuilder.addDefine(
      "HAS_SRGB_COLOR",
      undefined,
      ShaderDestination.FRAGMENT
    );
  }

  // The attributes, structs, and functions will need to be modified for 2D / CV.
  const mode = frameState.mode;
  const mode2D = mode === SceneMode.SCENE2D || mode === SceneMode.COLUMBUS_VIEW;
  const use2D = mode2D && !frameState.scene3DOnly && model._projectTo2D;

  for (let i = 0; i < primitive.attributes.length; i++) {
    const attribute = primitive.attributes[i];
    const attributeLocationCount = AttributeType.getAttributeLocationCount(
      attribute.type
    );
    const isPositionAttribute =
      attribute.semantic === VertexAttributeSemantic.POSITION;

    let index;
    if (attributeLocationCount > 1) {
      index = renderResources.attributeIndex;
      renderResources.attributeIndex += attributeLocationCount;
    } else if (isPositionAttribute && !use2D) {
      // If the scene is in 3D, the 2D position attribute is not needed,
      // so don't increment attributeIndex.
      index = 0;
    } else {
      index = renderResources.attributeIndex++;
    }

    processAttribute(
      renderResources,
      attribute,
      index,
      attributeLocationCount,
      frameState,
      use2D
    );
  }

  handleBitangents(shaderBuilder, primitive.attributes);

  if (primitive.primitiveType === PrimitiveType.POINTS) {
    shaderBuilder.addDefine("PRIMITIVE_TYPE_POINTS");
  }

  shaderBuilder.addVertexLines([GeometryStageVS]);
  shaderBuilder.addFragmentLines([GeometryStageFS]);
};

function processAttribute(
  renderResources,
  attribute,
  attributeIndex,
  attributeLocationCount,
  frameState,
  use2D
) {
  const shaderBuilder = renderResources.shaderBuilder;
  const attributeInfo = ModelExperimentalUtility.getAttributeInfo(attribute);

  if (attributeLocationCount > 1) {
    // Matrices are stored as multiple attributes, one per column vector.
    addMatrixAttributeToRenderResources(
      renderResources,
      attribute,
      attributeIndex,
      attributeLocationCount
    );
  } else {
    addAttributeToRenderResources(
      renderResources,
      attribute,
      attributeIndex,
      use2D
    );
  }

  addAttributeDeclaration(shaderBuilder, attributeInfo, use2D);
  addVaryingDeclaration(shaderBuilder, attributeInfo);

  // For common attributes like normals and tangents, the code is
  // already in GeometryStageVS, we just need to enable it.
  if (defined(attribute.semantic)) {
    addSemanticDefine(shaderBuilder, attribute);
  }

  // Some GLSL code must be dynamically generated
  updateAttributesStruct(shaderBuilder, attributeInfo, use2D);
  updateInitializeAttributesFunction(shaderBuilder, attributeInfo, use2D);
  updateSetDynamicVaryingsFunction(shaderBuilder, attributeInfo);
}

function addSemanticDefine(shaderBuilder, attribute) {
  const semantic = attribute.semantic;
  const setIndex = attribute.setIndex;
  switch (semantic) {
    case VertexAttributeSemantic.NORMAL:
      shaderBuilder.addDefine("HAS_NORMALS");
      break;
    case VertexAttributeSemantic.TANGENT:
      shaderBuilder.addDefine("HAS_TANGENTS");
      break;
    case VertexAttributeSemantic.FEATURE_ID:
      // `_FEATURE_ID starts with an underscore so no need to double the
      // underscore.
      shaderBuilder.addDefine(`HAS${semantic}_${setIndex}`);
      break;
    case VertexAttributeSemantic.TEXCOORD:
    case VertexAttributeSemantic.COLOR:
      shaderBuilder.addDefine(`HAS_${semantic}_${setIndex}`);
  }
}

function addAttributeToRenderResources(
  renderResources,
  attribute,
  attributeIndex,
  use2D
) {
  const quantization = attribute.quantization;
  let type;
  let componentDatatype;
  if (defined(quantization)) {
    type = quantization.type;
    componentDatatype = quantization.componentDatatype;
  } else {
    type = attribute.type;
    componentDatatype = attribute.componentDatatype;
  }

  const semantic = attribute.semantic;
  const setIndex = attribute.setIndex;
  if (
    semantic === VertexAttributeSemantic.FEATURE_ID &&
    setIndex >= renderResources.featureIdVertexAttributeSetIndex
  ) {
    renderResources.featureIdVertexAttributeSetIndex = setIndex + 1;
  }

  // The position attribute should always be in the first index.
  const isPositionAttribute = semantic === VertexAttributeSemantic.POSITION;
  const index = isPositionAttribute ? 0 : attributeIndex;
  const componentsPerAttribute = AttributeType.getNumberOfComponents(type);

  const vertexAttribute = {
    index: index,
    value: defined(attribute.buffer) ? undefined : attribute.constant,
    vertexBuffer: attribute.buffer,
    count: attribute.count,
    componentsPerAttribute: componentsPerAttribute,
    componentDatatype: componentDatatype,
    offsetInBytes: attribute.byteOffset,
    strideInBytes: attribute.byteStride,
    normalize: attribute.normalized,
  };

  renderResources.attributes.push(vertexAttribute);

  if (!isPositionAttribute || !use2D) {
    return;
  }

  // Add an additional attribute for the projected positions in 2D / CV.
  const buffer2D = renderResources.runtimePrimitive.positionBuffer2D;
  const positionAttribute2D = {
    index: attributeIndex,
    value: buffer2D ? undefined : attribute.constant,
    vertexBuffer: buffer2D,
    count: attribute.count,
    componentsPerAttribute: componentsPerAttribute,
    componentDatatype: ComponentDatatype.FLOAT, // The projected positions will always be floats.
    offsetInBytes: attribute.byteOffset,
    strideInBytes: attribute.byteStride,
    normalize: attribute.normalized,
  };

  renderResources.attributes.push(positionAttribute2D);
}

function addMatrixAttributeToRenderResources(
  renderResources,
  attribute,
  attributeIndex,
  columnCount
) {
  const quantization = attribute.quantization;
  let type;
  let componentDatatype;
  if (defined(quantization)) {
    type = quantization.type;
    componentDatatype = quantization.componentDatatype;
  } else {
    type = attribute.type;
    componentDatatype = attribute.componentDatatype;
  }

  const normalized = attribute.normalized;

  // componentCount is either 4, 9 or 16
  const componentCount = AttributeType.getNumberOfComponents(type);
  // componentsPerColumn is either 2, 3, or 4
  const componentsPerColumn = componentCount / columnCount;

  const componentSizeInBytes = ComponentDatatype.getSizeInBytes(
    componentDatatype
  );

  const columnLengthInBytes = componentsPerColumn * componentSizeInBytes;

  // The stride between corresponding columns of two matrices is constant
  // regardless of where you start
  const strideInBytes = attribute.byteStride;

  for (let i = 0; i < columnCount; i++) {
    const offsetInBytes = attribute.byteOffset + i * columnLengthInBytes;

    // upload a single column vector.
    const columnAttribute = {
      index: attributeIndex + i,
      vertexBuffer: attribute.buffer,
      componentsPerAttribute: componentsPerColumn,
      componentDatatype: componentDatatype,
      offsetInBytes: offsetInBytes,
      strideInBytes: strideInBytes,
      normalize: normalized,
    };

    renderResources.attributes.push(columnAttribute);
  }
}

function addVaryingDeclaration(shaderBuilder, attributeInfo) {
  const variableName = attributeInfo.variableName;
  let varyingName = `v_${variableName}`;

  let glslType;
  if (variableName === "normalMC") {
    // though the attribute is in model coordinates, the varying is
    // in eye coordinates.
    varyingName = "v_normalEC";
    glslType = attributeInfo.glslType;
  } else if (variableName === "tangentMC") {
    // Tangent's glslType is vec4, but in the shader it is split into
    // vec3 tangent and vec3 bitangent
    glslType = "vec3";
    // like normalMC, the varying is converted to eye coordinates
    varyingName = "v_tangentEC";
  } else {
    glslType = attributeInfo.glslType;
  }

  shaderBuilder.addVarying(glslType, varyingName);
}

function addAttributeDeclaration(shaderBuilder, attributeInfo, use2D) {
  const semantic = attributeInfo.attribute.semantic;
  const variableName = attributeInfo.variableName;

  let attributeName;
  let glslType;
  if (attributeInfo.isQuantized) {
    attributeName = `a_quantized_${variableName}`;
    glslType = attributeInfo.quantizedGlslType;
  } else {
    attributeName = `a_${variableName}`;
    glslType = attributeInfo.glslType;
  }

  const isPosition = semantic === VertexAttributeSemantic.POSITION;
  if (isPosition) {
    shaderBuilder.setPositionAttribute(glslType, attributeName);
  } else {
    shaderBuilder.addAttribute(glslType, attributeName);
  }

  if (isPosition && use2D) {
    shaderBuilder.addAttribute("vec3", "a_position2D");
  }
}

function updateAttributesStruct(shaderBuilder, attributeInfo, use2D) {
  const vsStructId = GeometryPipelineStage.STRUCT_ID_PROCESSED_ATTRIBUTES_VS;
  const fsStructId = GeometryPipelineStage.STRUCT_ID_PROCESSED_ATTRIBUTES_FS;
  const variableName = attributeInfo.variableName;

  if (variableName === "tangentMC") {
    // The w component of the tangent is only used for computing the bitangent,
    // so it can be separated from the other tangent components.
    shaderBuilder.addStructField(vsStructId, "vec3", "tangentMC");
    shaderBuilder.addStructField(vsStructId, "float", "tangentSignMC");
    // The tangent is in model coordinates in the vertex shader
    // but in eye space in the fragment coordinates
    shaderBuilder.addStructField(fsStructId, "vec3", "tangentEC");
  } else if (variableName === "normalMC") {
    // Normals are in model coordinates in the vertex shader but in eye
    // coordinates in the fragment shader
    shaderBuilder.addStructField(vsStructId, "vec3", "normalMC");
    shaderBuilder.addStructField(fsStructId, "vec3", "normalEC");
  } else {
    shaderBuilder.addStructField(
      vsStructId,
      attributeInfo.glslType,
      variableName
    );
    shaderBuilder.addStructField(
      fsStructId,
      attributeInfo.glslType,
      variableName
    );
  }

  if (variableName === "positionMC" && use2D) {
    shaderBuilder.addStructField(vsStructId, "vec3", "position2D");
  }
}

function updateInitializeAttributesFunction(
  shaderBuilder,
  attributeInfo,
  use2D
) {
  const functionId = GeometryPipelineStage.FUNCTION_ID_INITIALIZE_ATTRIBUTES;
  const variableName = attributeInfo.variableName;

  // If the scene is in 2D / CV mode, this line should always be added
  // regardless of whether the data is quantized.
  const use2DPosition = variableName === "positionMC" && use2D;
  if (use2DPosition) {
    const line = "attributes.position2D = a_position2D;";
    shaderBuilder.addFunctionLines(functionId, [line]);
  }

  if (attributeInfo.isQuantized) {
    // Skip initialization, it will be handled in the dequantization stage.
    return;
  }

  const lines = [];
  if (variableName === "tangentMC") {
    lines.push("attributes.tangentMC = a_tangentMC.xyz;");
    lines.push("attributes.tangentSignMC = a_tangentMC.w;");
  } else {
    lines.push(`attributes.${variableName} = a_${variableName};`);
  }

  shaderBuilder.addFunctionLines(functionId, lines);
}

function updateSetDynamicVaryingsFunction(shaderBuilder, attributeInfo) {
  const semantic = attributeInfo.attribute.semantic;
  const setIndex = attributeInfo.attribute.setIndex;
  if (defined(semantic) && !defined(setIndex)) {
    // positions, normals, and tangents are handled statically in
    // GeometryStageVS
    return;
  }

  // In the vertex shader, we want things like
  // v_texCoord_1 = attributes.texCoord_1;
  let functionId = GeometryPipelineStage.FUNCTION_ID_SET_DYNAMIC_VARYINGS_VS;
  const variableName = attributeInfo.variableName;
  let line = `v_${variableName} = attributes.${variableName};`;
  shaderBuilder.addFunctionLines(functionId, [line]);

  // In the fragment shader, we do the opposite:
  // attributes.texCoord_1 = v_texCoord_1;
  functionId = GeometryPipelineStage.FUNCTION_ID_SET_DYNAMIC_VARYINGS_FS;
  line = `attributes.${variableName} = v_${variableName};`;
  shaderBuilder.addFunctionLines(functionId, [line]);
}

function handleBitangents(shaderBuilder, attributes) {
  let hasNormals = false;
  let hasTangents = false;
  for (let i = 0; i < attributes.length; i++) {
    const attribute = attributes[i];
    if (attribute.semantic === VertexAttributeSemantic.NORMAL) {
      hasNormals = true;
    } else if (attribute.semantic === VertexAttributeSemantic.TANGENT) {
      hasTangents = true;
    }
  }

  // Bitangents are only defined if we have normals and tangents
  if (!hasNormals || !hasTangents) {
    return;
  }

  shaderBuilder.addDefine("HAS_BITANGENTS");

  shaderBuilder.addVarying("vec3", "v_bitangentEC");
  shaderBuilder.addStructField(
    GeometryPipelineStage.STRUCT_ID_PROCESSED_ATTRIBUTES_VS,
    "vec3",
    "bitangentMC"
  );
  shaderBuilder.addStructField(
    GeometryPipelineStage.STRUCT_ID_PROCESSED_ATTRIBUTES_FS,
    "vec3",
    "bitangentEC"
  );
}

export default GeometryPipelineStage;
