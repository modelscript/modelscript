# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Unit & formal soundness tests for `modelscript_trainer` (Tier 2 GPU Training Kernels).

Run from repo root:
    python3 -m unittest discover -s packages/ml-trainer/tests -v
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import numpy as np

# Allow discovery directly from repo root without requiring editable pip install
_PKG_ROOT = Path(__file__).resolve().parents[1]
if str(_PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(_PKG_ROOT))

from modelscript_trainer._backend import AdamW, as_tensor, to_numpy
from modelscript_trainer.train_dynamic_m import load_safetensors, main as train_main
from modelscript_trainer.zonotope_ops import (
    DiskAnnMemoryClient,
    DynamicMBucketSampler,
    DynamicMConfig,
    DynamicMLoraLinear,
    DynamicMRMSNorm,
    DynamicMReasoningModel,
    DynamicMSelfAttention,
    DynamicMSwiGLU,
    QueryProjectionHead,
    RelationalHypergraphDataset,
    RelationalZonotopeEmbedder,
    ZonotopeTensor,
    contract_generators,
    worst_case_logit_loss,
)


def _assert_enclosed(
    test_case: unittest.TestCase,
    concrete: np.ndarray,
    z: ZonotopeTensor,
    stage: str,
    tol: float = 1e-5,
) -> None:
    lo, hi, _ = z.bounds()
    lo_np = to_numpy(lo)
    hi_np = to_numpy(hi)
    low_viol = float(np.max(lo_np - concrete))
    high_viol = float(np.max(concrete - hi_np))
    test_case.assertLessEqual(
        low_viol,
        tol,
        f"[{stage}] Soundness violation below lower bound: max(lo - y) = {low_viol:.3e}",
    )
    test_case.assertLessEqual(
        high_viol,
        tol,
        f"[{stage}] Soundness violation above upper bound: max(y - hi) = {high_viol:.3e}",
    )


class TestDynamicMZonotopeOps(unittest.TestCase):
    def _sample_hypergraph_batch(self) -> dict[str, np.ndarray]:
        return {
            "token_ids": np.array(
                [
                    [12, 45, 78, 45, 91, 102],
                    [15, 33, 66, 33, 88, 99],
                ],
                dtype=np.int64,
            ),
            "group_ids": np.array(
                [
                    [0, 1, 2, 1, 3, 4],
                    [0, 1, 0, 1, 2, 3],
                ],
                dtype=np.int64,
            ),
            "rel_type_ids": np.array(
                [
                    [0, 1, 2, 1, 4, 6],
                    [0, 1, 0, 1, 5, 3],
                ],
                dtype=np.int64,
            ),
            "rel_signs": np.array(
                [
                    [0.0, 1.0, -1.0, 1.0, 1.0, -1.0],
                    [0.0, 1.0, 0.0, -1.0, 1.0, 1.0],
                ],
                dtype=np.float64,
            ),
        }

    def test_end_to_end_formal_soundness(self) -> None:
        """
        Verifies formal soundness: 64 sampled xi in [-1, 1]^m (including extreme corners)
        stay strictly enclosed through:
            Embedder -> RMSNorm -> SelfAttention -> SwiGLU -> Contraction
        """
        batch = self._sample_hypergraph_batch()
        B, L = batch["token_ids"].shape
        D = 16

        embedder = RelationalZonotopeEmbedder(vocab_size=128, dim=D, num_rel_types=8, init_radius=0.06, seed=42)
        rmsnorm = DynamicMRMSNorm(D)
        attn = DynamicMSelfAttention(D, num_heads=4, lora_rank=4, lora_alpha=8.0, seed=101)
        swiglu = DynamicMSwiGLU(D, intermediate_dim=24, lora_rank=4, lora_alpha=8.0, expansion_tau=1e-4, seed=202)

        z_emb = embedder(batch["token_ids"], batch["group_ids"], batch["rel_type_ids"], batch["rel_signs"], max_m=8)
        self.assertEqual(z_emb.center.shape, (B, L, D))
        self.assertEqual(z_emb.m, 4)

        # Locked syntax token at position 0 (group_id == 0) must have zero generator perturbation
        emb_gen_np = to_numpy(z_emb.generators)
        self.assertAlmostEqual(float(np.max(np.abs(emb_gen_np[:, :, 0, :]))), 0.0, places=10)

        z_norm = rmsnorm(z_emb)
        z_attn = attn(z_norm, causal=True)
        z_ffn, swiglu_events = swiglu(z_attn, layer_index=0)
        z_contracted, con_events = contract_generators(
            z_ffn,
            prune_eps=1e-4,
            collinear_cosine_threshold=0.98,
            m_cap=2,
            layer_index=0,
        )

        # Verify threshold-triggered expansion happened in SwiGLU and Girard cap enforced m <= 2
        self.assertTrue(any(e.kind == "expanded-nonlinear" for e in swiglu_events))
        self.assertLessEqual(z_contracted.m, 2)
        self.assertTrue(any(e.kind == "girard-capped" for e in con_events))

        # Sample random interior points AND extreme hypercube corners xi in [-1, 1]^m
        rng = np.random.default_rng(12345)
        xis = [rng.uniform(-1.0, 1.0, size=(B, z_emb.m)) for _ in range(48)]
        xis.extend([rng.choice([-1.0, 1.0], size=(B, z_emb.m)) for _ in range(16)])

        for xi in xis:
            x0 = z_emb.evaluate(xi)
            _assert_enclosed(self, to_numpy(x0), z_emb, "Embedder")

            x1 = rmsnorm.forward_point(x0)
            _assert_enclosed(self, to_numpy(x1), z_norm, "RMSNorm")

            x2 = attn.forward_point(x1, causal=True)
            _assert_enclosed(self, to_numpy(x2), z_attn, "SelfAttention")

            x3 = swiglu.forward_point(x2)
            _assert_enclosed(self, to_numpy(x3), z_ffn, "SwiGLU")
            _assert_enclosed(self, to_numpy(x3), z_contracted, "Contraction")

    def test_kv_cache_attention_soundness(self) -> None:
        """Verifies formally sound attention with DiskANN KV-cache prefix injection (both raw & projected)."""
        batch = self._sample_hypergraph_batch()
        B, _ = batch["token_ids"].shape
        D = 16
        L_mem = 3

        embedder = RelationalZonotopeEmbedder(vocab_size=128, dim=D, init_radius=0.05, seed=7)
        attn = DynamicMSelfAttention(D, num_heads=4, lora_rank=4, seed=88)
        z_in = embedder(batch["token_ids"], batch["group_ids"], batch["rel_type_ids"], batch["rel_signs"], max_m=6)

        rng = np.random.default_rng(99)
        # Retrieved DiskANN memory chunk hidden states [B, L_mem, D]
        mem_hidden = as_tensor(rng.normal(0.0, 0.4, size=(B, L_mem, D)), dtype="float")
        kv_raw = (mem_hidden, mem_hidden)

        z_out_raw = attn(z_in, kv_cache=kv_raw, causal=True)
        z_out_no_kv = attn(z_in, kv_cache=None, causal=True)
        # Injected DiskANN memory context should alter attention output
        self.assertGreater(float(np.max(np.abs(to_numpy(z_out_raw.center) - to_numpy(z_out_no_kv.center)))), 1e-4)

        # Also verify already-projected [B, H, L_mem, d_h] KV cache form
        k_proj = as_tensor(rng.normal(0.0, 0.3, size=(B, 4, L_mem, D // 4)), dtype="float")
        v_proj = as_tensor(rng.normal(0.0, 0.3, size=(B, 4, L_mem, D // 4)), dtype="float")
        z_out_proj = attn(z_in, kv_cache=(k_proj, v_proj), causal=True)

        for _ in range(32):
            xi = rng.uniform(-1.0, 1.0, size=(B, z_in.m))
            x_pt = z_in.evaluate(xi)
            y_raw = attn.forward_point(x_pt, kv_cache=kv_raw, causal=True)
            _assert_enclosed(self, to_numpy(y_raw), z_out_raw, "SelfAttention+KV(raw)")

            y_proj = attn.forward_point(x_pt, kv_cache=(k_proj, v_proj), causal=True)
            _assert_enclosed(self, to_numpy(y_proj), z_out_proj, "SelfAttention+KV(proj)")

    def test_contraction_pruning_collinear_and_girard_soundness(self) -> None:
        """Verifies vanishing pruning, collinear merging, and Girard capping preserve formal soundness."""
        rng = np.random.default_rng(777)
        B, L, D = 2, 4, 8
        c = as_tensor(rng.normal(0.0, 0.5, size=(B, L, D)), dtype="float")

        g0 = rng.normal(0.0, 0.3, size=(B, L, D))
        g1 = -0.7 * g0 + rng.normal(0.0, 1e-3, size=(B, L, D))  # Anti-parallel collinear (|cos| > 0.99)
        g2 = rng.normal(0.0, 1e-6, size=(B, L, D))  # Vanishing norm (< prune_eps=1e-4)
        g3 = rng.normal(0.0, 0.25, size=(B, L, D))
        g4 = rng.normal(0.0, 0.15, size=(B, L, D))
        gens = as_tensor(np.stack([g0, g1, g2, g3, g4], axis=1), dtype="float")  # [B, 5, L, D]
        z = ZonotopeTensor(center=c, generators=gens, group_ids=[[1, 2, 3, 4, 5]] * B)

        z_out, events = contract_generators(
            z,
            prune_eps=1e-4,
            collinear_cosine_threshold=0.98,
            m_cap=2,
            layer_index=2,
        )

        kinds = [e.kind for e in events]
        self.assertIn("pruned-vanishing", kinds)
        self.assertIn("merged-collinear", kinds)
        self.assertIn("girard-capped", kinds)
        self.assertEqual(z_out.m, 2)

        # Formal soundness: every concrete point in original z must remain enclosed in z_out
        for _ in range(48):
            xi = rng.choice([-1.0, 1.0], size=(B, 5))
            pt = z.evaluate(xi)
            _assert_enclosed(self, to_numpy(pt), z_out, "Contraction(all-3-stages)")

    def test_autograd_gradient_flow_and_frozen_base_weights(self) -> None:
        """
        Verifies end-to-end autograd gradient flow through all Dynamic-m layers, confirms
        frozen base_weight stays unchanged, and verifies worst-case boundary loss decreases.
        """
        batch = self._sample_hypergraph_batch()
        targets = np.roll(batch["token_ids"], -1, axis=1)

        cfg = DynamicMConfig(m_start=2, m_max=4, m_cap=4, expansion_tau=0.05, prune_eps=1e-5)
        model = DynamicMReasoningModel(
            vocab_size=128,
            hidden_dim=16,
            num_layers=2,
            num_heads=4,
            lora_rank=4,
            lora_alpha=8.0,
            retriever_dim=16,
            config=cfg,
            seed=2026,
        )

        frozen_snapshots = {
            name: to_numpy(p).copy()
            for name, p in model.named_parameters()
            if "base_weight" in name
        }
        self.assertGreater(len(frozen_snapshots), 0)

        # Forward + backward check
        fwd = model(batch["token_ids"], batch["group_ids"], batch["rel_type_ids"], batch["rel_signs"], active_m_cap=4)
        loss_res = worst_case_logit_loss(fwd["logits"], targets, worst_case_weight=0.5)
        loss_res["loss"].backward()

        nonzero_trainable = 0
        for name, p in model.named_parameters():
            if "base_weight" in name:
                self.assertFalse(p.requires_grad, f"{name} should be frozen")
                self.assertIsNone(p.grad, f"Frozen {name} should not receive gradients")
            elif not name.startswith("projection_head."):
                self.assertIsNotNone(p.grad, f"Trainable parameter {name} missing gradient")
                g_np = to_numpy(p.grad)
                self.assertTrue(np.all(np.isfinite(g_np)), f"Non-finite gradient in {name}")
                if float(np.linalg.norm(g_np)) > 0.0:
                    nonzero_trainable += 1

        self.assertGreaterEqual(nonzero_trainable, 12, "Expected active gradients across LoRA, RMSNorm & Embedder")

        # Run optimization steps and verify loss drops while frozen weights remain identical
        optimizer = AdamW([p for p in model.parameters() if p.requires_grad], lr=2e-2, weight_decay=0.0)
        losses: list[float] = []
        for _ in range(12):
            optimizer.zero_grad()
            out = model(batch["token_ids"], batch["group_ids"], batch["rel_type_ids"], batch["rel_signs"], active_m_cap=4)
            res = worst_case_logit_loss(out["logits"], targets, worst_case_weight=0.5)
            res["loss"].backward()
            optimizer.step()
            losses.append(float(res["loss"].item()))

        self.assertLess(losses[-1], losses[0] * 0.75, f"Expected loss to decrease significantly: {losses[0]:.4f} -> {losses[-1]:.4f}")

        for name, p in model.named_parameters():
            if name in frozen_snapshots:
                np.testing.assert_allclose(to_numpy(p), frozen_snapshots[name], atol=0.0)

    def test_dynamic_m_bucket_sampler_and_jsonl_shards(self) -> None:
        """Verifies JSONL shard ingestion and m_init-bucketed mini-batching minimize generator padding."""
        rows = [
            {"example_id": "e0", "uri": "a.mo", "dialect": "modelica", "m_init": 0, "token_ids": [1, 2, 3], "group_ids": [0, 0, 0], "rel_type_ids": [0, 0, 0], "rel_signs": [0, 0, 0]},
            {"example_id": "e1", "uri": "b.mo", "dialect": "modelica", "m_init": 18, "token_ids": [4, 5, 6, 7], "group_ids": [1, 2, 3, 4], "rel_type_ids": [1, 1, 2, 4], "rel_signs": [1, 1, -1, 1]},
            {"example_id": "e2", "uri": "c.scad", "dialect": "scad", "m_init": 1, "token_ids": [8, 9, 10], "group_ids": [0, 1, 1], "rel_type_ids": [0, 6, 6], "rel_signs": [0, 1, 1]},
            {"example_id": "e3", "uri": "d.mo", "dialect": "modelica", "m_init": 10, "token_ids": [11, 12, 13], "group_ids": [1, 2, 3], "rel_type_ids": [1, 2, 3], "rel_signs": [1, -1, 1]},
            {"example_id": "e4", "uri": "e.mo", "dialect": "modelica", "m_init": 11, "token_ids": [14, 15, 16], "group_ids": [1, 2, 3], "rel_type_ids": [1, 2, 3], "rel_signs": [1, -1, 1]},
            {"example_id": "e5", "uri": "f.scad", "dialect": "scad", "m_init": 22, "token_ids": [17, 18, 19], "group_ids": [1, 2, 0], "rel_type_ids": [6, 6, 0], "rel_signs": [1, -1, 0]},
        ]

        with tempfile.TemporaryDirectory() as tmp:
            shard_path = Path(tmp) / "bucket_test.jsonl"
            shard_path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")

            ds = RelationalHypergraphDataset([shard_path])
            self.assertEqual(len(ds), 6)

            sampler = DynamicMBucketSampler(ds, batch_size=2, m_cap=16, shuffle_buckets=False, seed=42)
            batches = list(sampler.iter_batches())
            self.assertEqual(len(batches), 3)

            # Bucketed in ascending m_init clipped to m_cap=16: [0,1], [10,11], [16,16]
            self.assertEqual([b["m_batch_max"] for b in batches], [1, 11, 16])
            self.assertEqual(batches[0]["example_ids"], ["e0", "e2"])
            self.assertEqual(batches[1]["example_ids"], ["e3", "e4"])
            self.assertEqual(batches[2]["example_ids"], ["e1", "e5"])

            # Feed first bucket directly into RelationalZonotopeEmbedder
            embedder = RelationalZonotopeEmbedder(vocab_size=64, dim=8, seed=1)
            z0 = embedder(
                batches[0]["token_ids"],
                batches[0]["group_ids"],
                batches[0]["rel_type_ids"],
                batches[0]["rel_signs"],
                max_m=batches[0]["m_batch_max"],
            )
            self.assertEqual(z0.m, 1)

    def test_query_projection_head_infonce_and_diskann_client(self) -> None:
        """Verifies InfoNCE W_q alignment convergence and DiskANN /api/v1/memory/query HTTP contract."""
        rng = np.random.default_rng(42)
        hidden_dim = 16
        retriever_dim = 32
        head = QueryProjectionHead(hidden_dim=hidden_dim, retriever_dim=retriever_dim, seed=777)

        # Synthetic aligned hidden-state -> retriever-chunk pairs
        B = 6
        h_batch = as_tensor(rng.normal(0.0, 1.0, size=(B, hidden_dim)), dtype="float")
        pos_batch = as_tensor(rng.normal(0.0, 1.0, size=(B, retriever_dim)), dtype="float")
        neg_batch = as_tensor(rng.normal(0.0, 1.0, size=(B, 5, retriever_dim)), dtype="float")

        # Output query vectors must be unit-normalized
        q0 = to_numpy(head.project(h_batch))
        np.testing.assert_allclose(np.linalg.norm(q0, axis=-1), np.ones(B), atol=1e-5)

        opt = AdamW(list(head.parameters()), lr=5e-2, weight_decay=0.0)
        init_res = head.infonce_loss(h_batch, pos_batch, negative_embs=neg_batch, temperature=0.25)
        init_loss = float(init_res["loss"].item())
        init_cos = float(init_res["positive_cosine"].item())

        for _ in range(50):
            opt.zero_grad()
            res = head.infonce_loss(h_batch, pos_batch, negative_embs=neg_batch, temperature=0.25)
            res["loss"].backward()
            opt.step()

        final_res = head.infonce_loss(h_batch, pos_batch, negative_embs=neg_batch, temperature=0.25)
        final_loss = float(final_res["loss"].item())
        final_cos = float(final_res["positive_cosine"].item())

        self.assertLess(final_loss, init_loss * 0.2, f"InfoNCE loss should drop sharply: {init_loss:.4f} -> {final_loss:.4f}")
        self.assertGreater(final_cos, max(0.85, init_cos + 0.5), f"Positive cosine should rise: {init_cos:.4f} -> {final_cos:.4f}")

        # Verify in-batch InfoNCE mode as well
        in_batch_res = head.infonce_loss(h_batch, pos_batch, negative_embs=None, temperature=0.1)
        self.assertTrue(np.isfinite(float(in_batch_res["loss"].item())))

        # Verify DiskAnnMemoryClient against local mock HTTP server
        received_requests: list[dict] = []

        class _MockHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                received_requests.append({"path": self.path, "body": body})
                resp = {
                    "backend": "diskann",
                    "embedderId": body.get("embedderId", "ansatz-embed-v1"),
                    "latencyMs": 3.2,
                    "chunks": [
                        {
                            "chunkId": "chk_msl_rc_01",
                            "sourceKind": "package-symbol",
                            "sourceUri": "msl/ThermalRC.mo",
                            "dialect": "modelica",
                            "score": 0.94,
                            "content": "model ThermalRC parameter Real R=10; end ThermalRC;",
                            "formalVerified": True,
                            "symbolTags": ["ThermalRC", "R"],
                        }
                    ],
                }
                encoded = json.dumps(resp).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, format: str, *args: object) -> None:
                return

        server = HTTPServer(("127.0.0.1", 0), _MockHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = DiskAnnMemoryClient(f"http://127.0.0.1:{port}/api/v1/memory", embedder_id="ansatz-embed-v1")
            q_vec = head.project(h_batch[0])
            resp = client.query_latent(q_vec, top_k=3, package_pins={"@modelica/msl": "4.0.0"}, dialects=["modelica"])
            self.assertEqual(resp["backend"], "diskann")
            self.assertEqual(len(resp["chunks"]), 1)
            self.assertEqual(received_requests[0]["path"], "/api/v1/memory/query")
            self.assertEqual(received_requests[0]["body"]["mode"], "latent")
            self.assertEqual(len(received_requests[0]["body"]["latentVector"]), retriever_dim)
            self.assertEqual(received_requests[0]["body"]["packagePins"], {"@modelica/msl": "4.0.0"})
        finally:
            server.shutdown()
            server.server_close()

    def test_train_dynamic_m_cli_exports_safetensors_and_manifest(self) -> None:
        """
        End-to-end test of `train_dynamic_m.py` with all flags emitted by `generatePyTorchSlurmRecipeExport`,
        verifying SafeTensors export, JSON weights export, and `lora-adapter` package.json manifest.
        """
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            shard_file = tmp_path / "shard_0001.jsonl"
            shard_rows = [
                {
                    "example_id": f"ex_{i}",
                    "uri": f"models/m_{i}.mo",
                    "dialect": "modelica",
                    "m_init": (i % 3) + 1,
                    "token_ids": [10 + i, 20 + i, 30 + i, 20 + i, 40 + i, 50 + i],
                    "group_ids": [0, 1, 2, 1, 3 if i % 2 == 0 else 0, 0],
                    "rel_type_ids": [0, 1, 2, 1, 4 if i % 2 == 0 else 0, 0],
                    "rel_signs": [0.0, 1.0, -1.0, 1.0, 1.0 if i % 2 == 0 else 0.0, 0.0],
                }
                for i in range(6)
            ]
            shard_file.write_text("\n".join(json.dumps(r) for r in shard_rows) + "\n", encoding="utf-8")

            manifest_file = tmp_path / "training-recipe.manifest.json"
            manifest_file.write_text(
                json.dumps(
                    {
                        "schema": "modelscript.training-recipe.v1",
                        "recipeName": "@ms/small-llm-cad-v1",
                        "recipeVersion": "1.2.0",
                        "targetModel": {"baseModel": "Qwen/Qwen2.5-Coder-1.5B", "parameterScale": "1.5B"},
                        "shards": [shard_file.name],
                    }
                ),
                encoding="utf-8",
            )
            out_dir = tmp_path / "checkpoints" / "ms_cad_v1"

            exit_code = train_main(
                [
                    "--manifest",
                    str(manifest_file),
                    "--base-model",
                    "Qwen/Qwen2.5-Coder-1.5B",
                    "--mode",
                    "posttrain-lora",
                    "--lora-rank",
                    "4",
                    "--m-start",
                    "1",
                    "--m-max",
                    "4",
                    "--m-cap",
                    "8",
                    "--expansion-tau",
                    "0.05",
                    "--prune-eps",
                    "0.0001",
                    "--diskann-url",
                    "http://localhost:3001/api/v1/memory",
                    "--output-dir",
                    str(out_dir),
                    "--epochs",
                    "2",
                    "--batch-size",
                    "2",
                    "--hidden-dim",
                    "16",
                    "--num-layers",
                    "1",
                    "--num-heads",
                    "4",
                    "--vocab-size",
                    "128",
                    "--retriever-dim",
                    "16",
                ]
            )
            self.assertEqual(exit_code, 0)

            st_path = out_dir / "adapter_model.safetensors"
            json_path = out_dir / "adapter_weights.json"
            pkg_path = out_dir / "package.json"
            self.assertTrue(st_path.exists())
            self.assertTrue(json_path.exists())
            self.assertTrue(pkg_path.exists())

            # Reload SafeTensors binary and verify tensors & metadata
            tensors, meta = load_safetensors(st_path)
            self.assertGreater(len(tensors), 4)
            self.assertTrue(any("lora_a" in k for k in tensors))
            self.assertTrue(any("lora_b" in k for k in tensors))
            self.assertEqual(meta["base_model"], "Qwen/Qwen2.5-Coder-1.5B")
            self.assertEqual(meta["lora_rank"], "4")
            self.assertEqual(meta["m_cap"], "8")

            # Verify lora-adapter package manifest
            pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
            self.assertEqual(pkg["modelscript"]["category"], "lora-adapter")
            self.assertEqual(pkg["modelscript"]["ml"]["kind"], "lora-adapter")
            self.assertEqual(pkg["modelscript"]["ml"]["dynamicM"]["mCap"], 8)
            self.assertEqual(pkg["modelscript"]["ml"]["targetModel"]["loraRank"], 4)
            self.assertEqual(pkg["modelscript"]["artifacts"]["safetensors"], "adapter_model.safetensors")

    def test_train_dynamic_m_streams_live_run_metrics(self) -> None:
        """
        Verifies `train_dynamic_m.py` streams per-epoch Dynamic-m telemetry to
        `POST <run-api-url>/api/v1/runs/<run-uid>/metrics` with optional Bearer auth,
        and remains non-fatal when the telemetry endpoint is unreachable.
        """
        received_metrics: list[dict] = []

        class _RunMetricsHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                received_metrics.append(
                    {
                        "path": self.path,
                        "auth": self.headers.get("Authorization"),
                        "body": body,
                    }
                )
                encoded = json.dumps({"ok": True}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, format: str, *args: object) -> None:
                return

        server = HTTPServer(("127.0.0.1", 0), _RunMetricsHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "ckpt_stream"
                exit_code = train_main(
                    [
                        "--mode",
                        "posttrain-lora",
                        "--lora-rank",
                        "4",
                        "--m-start",
                        "1",
                        "--m-max",
                        "3",
                        "--m-cap",
                        "4",
                        "--output-dir",
                        str(out_dir),
                        "--epochs",
                        "2",
                        "--batch-size",
                        "2",
                        "--hidden-dim",
                        "16",
                        "--num-layers",
                        "1",
                        "--num-heads",
                        "4",
                        "--vocab-size",
                        "64",
                        "--retriever-dim",
                        "16",
                        "--run-api-url",
                        f"http://127.0.0.1:{port}",
                        "--run-uid",
                        "run_wave_a1_test",
                        "--run-auth-token",
                        "tok_secret_a1",
                    ]
                )
                self.assertEqual(exit_code, 0)
        finally:
            server.shutdown()
            server.server_close()

        self.assertEqual(len(received_metrics), 2)
        expected_fields = {
            "step",
            "epoch",
            "center_loss",
            "worst_case_loss",
            "m_active",
            "max_spread_delta_t",
            "pruned_count",
            "merged_count",
            "expanded_count",
            "girard_cap_count",
        }
        for idx, req in enumerate(received_metrics):
            self.assertEqual(req["path"], "/api/v1/runs/run_wave_a1_test/metrics")
            self.assertEqual(req["auth"], "Bearer tok_secret_a1")
            body = req["body"]
            self.assertTrue(expected_fields.issubset(body.keys()))
            self.assertEqual(body["epoch"], idx)
            self.assertGreater(body["step"], 0)
            self.assertGreaterEqual(body["m_active"], 1)
            self.assertGreaterEqual(body["worst_case_loss"], body["center_loss"] - 1e-6)
            self.assertGreaterEqual(body["max_spread_delta_t"], 0.0)
            self.assertGreaterEqual(body["pruned_count"], 0)
            self.assertGreaterEqual(body["merged_count"], 0)
            self.assertGreaterEqual(body["expanded_count"], 0)
            self.assertGreaterEqual(body["girard_cap_count"], 0)
        self.assertGreater(received_metrics[1]["body"]["step"], received_metrics[0]["body"]["step"])

        # Verify unreachable telemetry endpoint is strictly non-fatal
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / "ckpt_offline"
            exit_code = train_main(
                [
                    "--mode",
                    "posttrain-lora",
                    "--lora-rank",
                    "4",
                    "--m-start",
                    "1",
                    "--m-max",
                    "2",
                    "--m-cap",
                    "4",
                    "--output-dir",
                    str(out_dir),
                    "--epochs",
                    "1",
                    "--batch-size",
                    "2",
                    "--hidden-dim",
                    "16",
                    "--num-layers",
                    "1",
                    "--num-heads",
                    "4",
                    "--vocab-size",
                    "64",
                    "--retriever-dim",
                    "16",
                    "--run-api-url",
                    f"http://127.0.0.1:{port}",  # server already closed
                    "--run-uid",
                    "run_offline_test",
                ]
            )
            self.assertEqual(exit_code, 0)
            self.assertTrue((out_dir / "adapter_model.safetensors").exists())


if __name__ == "__main__":
    unittest.main()
