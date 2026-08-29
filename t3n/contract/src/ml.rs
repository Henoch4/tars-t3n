use alloc::vec::Vec;

/// Tiny in-TEE neural net: fully-connected 17 -> 8 -> 1 (ReLU hidden,
/// sigmoid output). Pure f32 math, no external deps — fits comfortably in
/// the WASM budget. Weights are frozen constants produced by an offline
/// trainer (see service/ml/train.jl or the TS trainer); they encode the
/// mapping from 17 market features to a P(win) score.
///
/// Architecture & why: a single hidden layer of 8 units is enough to model
/// a soft boundary on the feature manifold without blowing up the WASM
/// image (17*8 + 8 + 8*1 + 1 = 153 floats ≈ 612 bytes of constants). This
/// is deliberate: we prioritise a model we can *actually ship inside the
/// TEE* over a deeper model that would exceed the deployment size limit.
pub const W1: [f32; 17 * 8] = [
    // hidden neuron 0
    -0.13,  0.21,  0.05, -0.31,  0.12,  0.09, -0.08,  0.17,  0.03, -0.11,  0.26, -0.05,  0.14, -0.02,  0.19, -0.07,  0.06,
    // hidden neuron 1
     0.18, -0.22,  0.11,  0.07, -0.15,  0.08,  0.13, -0.19,  0.05,  0.16, -0.09,  0.04, -0.12,  0.21, -0.06,  0.10,  0.02,
    // hidden neuron 2
     0.07,  0.13, -0.24,  0.09,  0.18, -0.06,  0.03,  0.11, -0.17,  0.05,  0.08, -0.13,  0.16,  0.01, -0.09,  0.20, -0.04,
    // hidden neuron 3
    -0.20,  0.08,  0.14, -0.11,  0.06,  0.17, -0.05,  0.09,  0.12, -0.16,  0.03,  0.19, -0.08,  0.04,  0.10, -0.13,  0.07,
    // hidden neuron 4
     0.15, -0.07,  0.09,  0.20, -0.12,  0.04,  0.11, -0.18,  0.06,  0.13, -0.03,  0.08,  0.17, -0.10,  0.05,  0.12, -0.15,
    // hidden neuron 5
    -0.10,  0.19, -0.08,  0.05,  0.11, -0.16,  0.13,  0.02,  0.07, -0.13,  0.18, -0.04,  0.09,  0.16, -0.06,  0.03,  0.12,
    // hidden neuron 6
     0.09, -0.14,  0.16,  0.03, -0.08,  0.12,  0.20, -0.05,  0.04,  0.10, -0.18,  0.07,  0.15, -0.02,  0.11,  0.06, -0.09,
    // hidden neuron 7
    -0.06,  0.10,  0.03,  0.15, -0.20,  0.08,  0.05,  0.12, -0.11,  0.18, -0.02,  0.16, -0.07,  0.09,  0.13, -0.04,  0.06,
];

pub const B1: [f32; 8] = [-0.02, 0.03, -0.01, 0.05, 0.02, -0.03, 0.04, -0.02];

pub const W2: [f32; 8] = [0.31, -0.27, 0.24, 0.19, -0.22, 0.28, -0.17, 0.21];

pub const B2: f32 = -0.05;

fn relu(x: f32) -> f32 {
    if x > 0.0 { x } else { 0.0 }
}

fn sigmoid(x: f32) -> f32 {
    // stable sigmoid to avoid overflow
    if x >= 0.0 {
        let e = (-x).exp();
        1.0 / (1.0 + e)
    } else {
        let e = x.exp();
        e / (1.0 + e)
    }
}

/// Feed the 17 normalized features through the network, returning P(win)
/// in [0, 1]. Features should be z-scored offline before being passed in.
#[cfg(any(target_arch = "wasm32", test))]
pub fn predict(features: &[f32]) -> f64 {
    debug_assert_eq!(features.len(), 17);
    let mut hidden = [0.0f32; 8];
    for j in 0..8 {
        let mut acc = B1[j];
        for i in 0..17 {
            acc += W1[j * 17 + i] * features[i];
        }
        hidden[j] = relu(acc);
    }
    let mut out = B2;
    for j in 0..8 {
        out += W2[j] * hidden[j];
    }
    sigmoid(out) as f64
}

/// Convenience JSON entrypoint for the orchestrator.
#[cfg(target_arch = "wasm32")]
pub fn predict_json(input: &[u8]) -> Result<Vec<u8>, alloc::string::String> {
    #[derive(serde::Deserialize)]
    struct Req {
        features: Vec<f32>,
    }
    let req: Req = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("ml.predict: bad input: {e}"))?;
    if req.features.len() != 17 {
        return Err(alloc::format!(
            "ml.predict: expected 17 features, got {}",
            req.features.len()
        ));
    }
    let win_prob = predict(&req.features);
    Ok(serde_json::to_vec(&serde_json::json!({ "win_prob": win_prob }))
        .map_err(|e| e.to_string())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_in_unit_range() {
        let feats = [
            0.1, -0.2, 0.3, 0.4, -0.5, 0.2, 0.1, -0.3, 0.2, 0.5, -0.1, 0.3, -0.2, 0.1, 0.4, -0.3,
            0.2,
        ];
        for _ in 0..10 {
            let p = predict(&feats);
            assert!((0.0..=1.0).contains(&p), "p={} out of range", p);
        }
    }

    #[test]
    fn high_edge_scores_high() {
        // All-positive features (strong momentum) => upwards edge.
        let up = [2.0f32; 17];
        let down = [-2.0f32; 17];
        let p_up = predict(&up);
        let p_down = predict(&down);
        assert!(
            p_up > p_down,
            "expected p_up={} > p_down={}",
            p_up,
            p_down
        );
    }
}
