import { ResearchPaperNode, RelationType, PaperStatus } from '../types';

export interface LinkedPaperItem {
  id: string;
  title: string;
  authors: string;
  year: number;
  venue: string;
  arxivId?: string;
  url?: string;
  abstract: string;
  keyInsights: string[];
  tags: string[];
  citationsCount: number;
  status: PaperStatus;
  color: string;
  linkedToNodeId?: string;
  linkedToPaperTitle: string;
  relationType: RelationType;
  relationDescription: string;
}

export const LINKED_PAPERS_DATABASE: Record<string, LinkedPaperItem[]> = {
  // 1. Attention Is All You Need (Vaswani et al.)
  'paper-vaswani': [
    {
      id: 'paper-roformer',
      title: 'RoFormer: Enhanced Transformer with Rotary Position Embedding',
      authors: 'Su, Lu, Pan, Murtadha, Wen, Liu',
      year: 2021,
      venue: 'Neurocomputing 2024',
      arxivId: '2104.09864',
      url: 'https://arxiv.org/abs/2104.09864',
      abstract: 'Introduces Rotary Position Embedding (RoPE) to effectively incorporate relative position dependency into Transformer self-attention using rotation matrices.',
      keyInsights: [
        'Rotary matrix encoding preserves relative distance decay',
        'Adopted by modern LLMs including LLaMA, PaLM, and Mistral',
        'Decouples token position from linear vector norms',
      ],
      tags: ['RoPE', 'Positional Encoding', 'Architecture'],
      citationsCount: 1950,
      status: 'seminal',
      color: '#6366f1',
      linkedToNodeId: 'paper-vaswani',
      linkedToPaperTitle: 'Attention Is All You Need',
      relationType: 'improves',
      relationDescription: 'Replaces absolute sinusoidal encodings with rotary relative matrices',
    },
    {
      id: 'paper-transformer-xl',
      title: 'Transformer-XL: Attentive Language Models Beyond a Fixed-Length Context',
      authors: 'Dai, Yang, Yang, Carbonell, Le, Salakhutdinov',
      year: 2019,
      venue: 'ACL 2019',
      arxivId: '1901.02860',
      url: 'https://arxiv.org/abs/1901.02860',
      abstract: 'Enables learning dependency beyond a fixed length without disrupting temporal coherence through segment-level recurrence and relative positional encodings.',
      keyInsights: [
        'Segment-level recurrence mechanism caches hidden states',
        'Relative positional encoding resolves context fragmentation',
        '84% longer dependency learning than vanilla Transformers',
      ],
      tags: ['Long Context', 'Recurrence', 'Transformers'],
      citationsCount: 4200,
      status: 'read',
      color: '#4f46e5',
      linkedToNodeId: 'paper-vaswani',
      linkedToPaperTitle: 'Attention Is All You Need',
      relationType: 'extends',
      relationDescription: 'Introduces segment recurrence to overcome context length limits',
    },
    {
      id: 'paper-reformer',
      title: 'Reformer: The Efficient Transformer',
      authors: 'Kitaev, Kaiser, Levskaya',
      year: 2020,
      venue: 'ICLR 2020',
      arxivId: '2001.04451',
      url: 'https://arxiv.org/abs/2001.04451',
      abstract: 'Replaces dot-product attention with locality-sensitive hashing (LSH), reducing attention complexity from O(N²) to O(N log N).',
      keyInsights: [
        'Locality-sensitive hashing clusters similar queries and keys',
        'Reversible residual layers save intermediate activation memory',
      ],
      tags: ['Efficiency', 'LSH Attention', 'Reversible'],
      citationsCount: 2900,
      status: 'to-read',
      color: '#0284c7',
      linkedToNodeId: 'paper-vaswani',
      linkedToPaperTitle: 'Attention Is All You Need',
      relationType: 'improves',
      relationDescription: 'Reduces O(N²) complexity to O(N log N) via hashing',
    },
    {
      id: 'paper-lora',
      title: 'LoRA: Low-Rank Adaptation of Large Language Models',
      authors: 'Hu, Shen, Wallis, Allen-Zhu, Li, Wang, Wang, Chen',
      year: 2021,
      venue: 'ICLR 2022',
      arxivId: '2106.09685',
      url: 'https://arxiv.org/abs/2106.09685',
      abstract: 'Freezes pre-trained model weights and injects trainable rank decomposition matrices into Transformer attention layers, reducing trainable parameters by 10,000x.',
      keyInsights: [
        'Injects low-rank matrices A and B into attention Wq, Wv',
        'Zero inference latency overhead via weight folding',
        'Enables fine-tuning massive LLMs on consumer GPUs',
      ],
      tags: ['PEFT', 'LoRA', 'Fine-Tuning', 'Efficiency'],
      citationsCount: 16500,
      status: 'seminal',
      color: '#0ea5e9',
      linkedToNodeId: 'paper-vaswani',
      linkedToPaperTitle: 'Attention Is All You Need',
      relationType: 'extends',
      relationDescription: 'Efficient parameter fine-tuning for attention projection layers',
    },
    {
      id: 'paper-chinchilla',
      title: 'Training Compute-Optimal Large Language Models (Chinchilla)',
      authors: 'Hoffmann et al. (DeepMind)',
      year: 2022,
      venue: 'NeurIPS 2022',
      arxivId: '2203.15556',
      url: 'https://arxiv.org/abs/2203.15556',
      abstract: 'Investigates optimal compute allocation between model size and training tokens, establishing that scaling tokens equally with parameters is compute-optimal.',
      keyInsights: [
        'Demonstrates 70B model on 1.4T tokens outperforms 175B on 300B tokens',
        'Corrected Kaplan et al. scaling law ratios',
        'Foundation for LLaMA and compact high-capability LLMs',
      ],
      tags: ['Scaling Laws', 'Compute Optimal', 'Pretraining'],
      citationsCount: 3800,
      status: 'read',
      color: '#8b5cf6',
      linkedToNodeId: 'paper-vaswani',
      linkedToPaperTitle: 'Attention Is All You Need',
      relationType: 'benchmarks',
      relationDescription: 'Compute-optimal token and parameter balance for Transformers',
    },
  ],

  // 2. BERT
  'paper-bert': [
    {
      id: 'paper-roberta',
      title: 'RoBERTa: A Robustly Optimized BERT Pretraining Approach',
      authors: 'Liu, Ott, Goyal, Du, Joshi, Chen, Levy, Lewis, Zettlemoyer, Stoyanov',
      year: 2019,
      venue: 'arXiv 2019',
      arxivId: '1907.11692',
      url: 'https://arxiv.org/abs/1907.11692',
      abstract: 'Shows that BERT was significantly undertrained and can match or exceed post-BERT architectures by removing NSP, training with larger batches, and dynamic masking.',
      keyInsights: [
        'Removed Next Sentence Prediction (NSP) objective',
        'Dynamic masking across epochs improves representation quality',
        'Trained on 160GB text corpus with batch sizes up to 8K',
      ],
      tags: ['Pretraining', 'Encoders', 'GLUE'],
      citationsCount: 22000,
      status: 'read',
      color: '#0284c7',
      linkedToNodeId: 'paper-bert',
      linkedToPaperTitle: 'BERT',
      relationType: 'improves',
      relationDescription: 'Optimizes pretraining pipeline and removes Next Sentence Prediction',
    },
    {
      id: 'paper-sbert',
      title: 'Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks',
      authors: 'Reimers & Gurevych',
      year: 2019,
      venue: 'EMNLP 2019',
      arxivId: '1908.10084',
      url: 'https://arxiv.org/abs/1908.10084',
      abstract: 'Modification of pre-trained BERT using siamese and triplet network structures to derive semantically meaningful sentence embeddings that can be compared via cosine similarity.',
      keyInsights: [
        'Reduces finding most similar pair from 65 hours to 5 seconds',
        'Siamese network structure with mean-pooling over BERT outputs',
        'Core building block for semantic search and dense retrieval in RAG',
      ],
      tags: ['Embeddings', 'Siamese', 'Semantic Search', 'RAG'],
      citationsCount: 14500,
      status: 'seminal',
      color: '#059669',
      linkedToNodeId: 'paper-bert',
      linkedToPaperTitle: 'BERT',
      relationType: 'extends',
      relationDescription: 'Siamese architecture creating high-speed cosine sentence embeddings',
    },
    {
      id: 'paper-deberta',
      title: 'DeBERTa: Decoding-enhanced BERT with Disentangled Attention',
      authors: 'He, Liu, Gao, Chen',
      year: 2020,
      venue: 'ICLR 2021',
      arxivId: '2006.03654',
      url: 'https://arxiv.org/abs/2006.03654',
      abstract: 'Improves BERT with two novel techniques: disentangled attention representing content and relative position separately, and an enhanced mask decoder.',
      keyInsights: [
        'Disentangled attention decomposes word pairs into content-to-content and content-to-position',
        'Enhanced Mask Decoder incorporates absolute positions right before prediction',
        'First model to surpass human baseline on SuperGLUE benchmark',
      ],
      tags: ['Disentangled Attention', 'Encoders', 'SuperGLUE'],
      citationsCount: 3100,
      status: 'read',
      color: '#3b82f6',
      linkedToNodeId: 'paper-bert',
      linkedToPaperTitle: 'BERT',
      relationType: 'improves',
      relationDescription: 'Disentangles content and positional attention matrices',
    },
  ],

  // 3. GPT-3
  'paper-gpt3': [
    {
      id: 'paper-instructgpt',
      title: 'Training language models to follow instructions with human feedback',
      authors: 'Ouyang et al. (OpenAI)',
      year: 2022,
      venue: 'NeurIPS 2022',
      arxivId: '2203.02155',
      url: 'https://arxiv.org/abs/2203.02155',
      abstract: 'Aligns language models with human intent using Reinforcement Learning from Human Feedback (RLHF), demonstrating 1.3B InstructGPT is preferred over 175B GPT-3.',
      keyInsights: [
        'Three-step pipeline: Supervised Fine-Tuning (SFT), Reward Modeling, PPO RL',
        'Drastic reduction in toxic outputs and hallucinated assertions',
        'Foundation of ChatGPT and conversational AI revolution',
      ],
      tags: ['RLHF', 'Alignment', 'InstructGPT', 'PPO'],
      citationsCount: 8400,
      status: 'seminal',
      color: '#10b981',
      linkedToNodeId: 'paper-gpt3',
      linkedToPaperTitle: 'Language Models are Few-Shot Learners',
      relationType: 'extends',
      relationDescription: 'Aligns raw scaling with human feedback (RLHF / PPO)',
    },
    {
      id: 'paper-dpo',
      title: 'Direct Preference Optimization: Your Language Model is Secretly a Reward Model',
      authors: 'Rafailov, Sharma, Mitchell, Ermon, Manning, Finn',
      year: 2023,
      venue: 'NeurIPS 2023',
      arxivId: '2305.18290',
      url: 'https://arxiv.org/abs/2305.18290',
      abstract: 'Eliminates the unstable reinforcement learning phase in RLHF by mathematically deriving an exact closed-form objective directly on prompt-chosen-rejected triplets.',
      keyInsights: [
        'Solves preference optimization with a simple cross-entropy binary loss',
        'No separate reward model or complex PPO hyperparameter tuning needed',
        'Now the primary alignment method for open weights (Llama 3, Mistral)',
      ],
      tags: ['DPO', 'Alignment', 'Reward Modeling'],
      citationsCount: 4100,
      status: 'seminal',
      color: '#8b5cf6',
      linkedToNodeId: 'paper-gpt3',
      linkedToPaperTitle: 'Language Models are Few-Shot Learners',
      relationType: 'improves',
      relationDescription: 'Replaces complex PPO RL with direct closed-form preference loss',
    },
    {
      id: 'paper-cot',
      title: 'Chain-of-Thought Prompting Elicits Reasoning in Large Language Models',
      authors: 'Wei, Wang, Schuurmans, Bosma, Ichter, Xia, Chi, Le, Zhou',
      year: 2022,
      venue: 'NeurIPS 2022',
      arxivId: '2201.11903',
      url: 'https://arxiv.org/abs/2201.11903',
      abstract: 'Generates a chain of intermediate reasoning steps before answering, unlocking multi-step arithmetic, symbolic manipulation, and commonsense reasoning in LLMs.',
      keyInsights: [
        'Emergent capability at scale (>100B parameters)',
        'GSM8K math benchmark score jumped from 18% to 57%',
        'Foundation for modern reasoning agents and step-by-step verification',
      ],
      tags: ['Reasoning', 'Chain-of-Thought', 'Prompting'],
      citationsCount: 6800,
      status: 'seminal',
      color: '#f59e0b',
      linkedToNodeId: 'paper-gpt3',
      linkedToPaperTitle: 'Language Models are Few-Shot Learners',
      relationType: 'extends',
      relationDescription: 'Elicits multi-step reasoning through intermediate thought steps',
    },
  ],

  // 4. FlashAttention
  'paper-flash': [
    {
      id: 'paper-flash2',
      title: 'FlashAttention-2: Faster Attention with Better Parallelism and Work Partitioning',
      authors: 'Dao (Princeton)',
      year: 2023,
      venue: 'ICLR 2024',
      arxivId: '2307.08691',
      url: 'https://arxiv.org/abs/2307.08691',
      abstract: 'Enhances FlashAttention with 2x speedup by reducing non-matmul FLOPs, parallelizing across the sequence length dimension, and optimizing work distribution between warps.',
      keyInsights: [
        'Reaches 73% theoretical peak FLOPs on A100 GPU (225 TFLOPs/s)',
        'Parallelizes over sequence length rather than just batch and heads',
        'Enables efficient training with 32K+ token context windows',
      ],
      tags: ['Hardware Acceleration', 'GPU SRAM', 'Kernels'],
      citationsCount: 1800,
      status: 'seminal',
      color: '#d97706',
      linkedToNodeId: 'paper-flash',
      linkedToPaperTitle: 'FlashAttention',
      relationType: 'improves',
      relationDescription: '2x speedup via parallel work partitioning along sequence length',
    },
    {
      id: 'paper-vllm',
      title: 'Efficient Memory Management for Large Language Model Serving with PagedAttention',
      authors: 'Kwon, Li, Zhuang, Sheng, Zheng, Yu, Gonzalez, Zhang, Stoica (UC Berkeley)',
      year: 2023,
      venue: 'SOSP 2023',
      arxivId: '2309.06180',
      url: 'https://arxiv.org/abs/2309.06180',
      abstract: 'PagedAttention applies OS virtual memory paging principles to LLM KV cache management, reducing memory waste from 80% down to under 4% and boosting throughput 4x.',
      keyInsights: [
        'Stores continuous KV cache in non-contiguous physical memory blocks',
        'Near-zero memory fragmentation enables 2-4x higher concurrency',
        'Powers the open-source vLLM inference engine',
      ],
      tags: ['Inference', 'KV Cache', 'Serving', 'vLLM'],
      citationsCount: 2400,
      status: 'seminal',
      color: '#2563eb',
      linkedToNodeId: 'paper-flash',
      linkedToPaperTitle: 'FlashAttention',
      relationType: 'extends',
      relationDescription: 'Virtual memory paging applied to KV cache allocation during inference',
    },
    {
      id: 'paper-ring',
      title: 'RingAttention with Blockwise Transformers for Near-Infinite Context',
      authors: 'Liu, Yan, Abbeel (UC Berkeley)',
      year: 2023,
      venue: 'ICLR 2024',
      arxivId: '2310.01889',
      url: 'https://arxiv.org/abs/2310.01889',
      abstract: 'Distributes long sequences across multiple GPUs in a ring topology, overlapping memory communication with computation to scale context size to millions of tokens.',
      keyInsights: [
        'Memory per device remains constant as total sequence length increases',
        'Enabled Gemini and subsequent frontier models to reach 1M - 10M token context',
      ],
      tags: ['Distributed', 'Infinite Context', 'Ring Attention'],
      citationsCount: 650,
      status: 'read',
      color: '#7c3aed',
      linkedToNodeId: 'paper-flash',
      linkedToPaperTitle: 'FlashAttention',
      relationType: 'extends',
      relationDescription: 'Overlaps communication in a GPU ring to scale context to millions',
    },
  ],

  // 5. LLaMA
  'paper-llama': [
    {
      id: 'paper-llama2',
      title: 'LLaMA 2: Open Foundation and Fine-Tuned Chat Models',
      authors: 'Touvron et al. (Meta AI)',
      year: 2023,
      venue: 'arXiv 2023',
      arxivId: '2307.09288',
      url: 'https://arxiv.org/abs/2307.09288',
      abstract: 'Releases upgraded models trained on 40% more data (2T tokens), introducing Grouped-Query Attention (GQA) for fast inference and Ghost Attention for multi-turn chats.',
      keyInsights: [
        'Grouped-Query Attention (GQA) cuts KV cache bandwidth requirements',
        'Extensive iterative RLHF with rejection sampling and PPO',
        'Set the benchmark for enterprise open-source model deployment',
      ],
      tags: ['Open Weights', 'GQA', 'Chat Models', 'LLaMA 2'],
      citationsCount: 8200,
      status: 'read',
      color: '#9333ea',
      linkedToNodeId: 'paper-llama',
      linkedToPaperTitle: 'LLaMA',
      relationType: 'extends',
      relationDescription: 'Adds Grouped-Query Attention (GQA) and 2T token pretraining',
    },
    {
      id: 'paper-qlora',
      title: 'QLoRA: Efficient Finetuning of Quantized LLMs',
      authors: 'Dettmers, Pagnoni, Holtzman, Zettlemoyer (UW)',
      year: 2023,
      venue: 'NeurIPS 2023',
      arxivId: '2305.14314',
      url: 'https://arxiv.org/abs/2305.14314',
      abstract: 'Enables fine-tuning a 65B parameter model on a single 48GB GPU without performance degradation via 4-bit NormalFloat (NF4) and Double Quantization.',
      keyInsights: [
        'NF4 data type theoretically optimal for normally distributed weights',
        'Double Quantization saves an additional 0.37 bits per parameter',
        'Paged Optimizers manage memory spikes during gradient updates',
      ],
      tags: ['Quantization', 'QLoRA', 'NF4', 'Fine-Tuning'],
      citationsCount: 4900,
      status: 'seminal',
      color: '#ec4899',
      linkedToNodeId: 'paper-llama',
      linkedToPaperTitle: 'LLaMA',
      relationType: 'extends',
      relationDescription: '4-bit NormalFloat quantization allowing 65B finetuning on 1 GPU',
    },
    {
      id: 'paper-mistral',
      title: 'Mistral 7B',
      authors: 'Jiang et al. (Mistral AI)',
      year: 2023,
      venue: 'arXiv 2023',
      arxivId: '2310.06825',
      url: 'https://arxiv.org/abs/2310.06825',
      abstract: 'A 7-billion parameter language model engineered for superior efficiency, outperforming LLaMA 2 13B across all benchmarks via Sliding Window Attention.',
      keyInsights: [
        'Sliding Window Attention (SWA) caches theoretical 128K context at low cost',
        'Grouped-Query Attention (GQA) enables lightning-fast token generation',
        'Became the base foundation for Mixtral 8x7B Mixture-of-Experts',
      ],
      tags: ['Sliding Window', 'Open Source', 'High Efficiency'],
      citationsCount: 2300,
      status: 'read',
      color: '#f97316',
      linkedToNodeId: 'paper-llama',
      linkedToPaperTitle: 'LLaMA',
      relationType: 'improves',
      relationDescription: 'Outperforms LLaMA 2 13B using Sliding Window Attention & GQA',
    },
  ],

  // 6. Diffusion Papers (dash-2)
  'paper-ddpm': [
    {
      id: 'paper-score',
      title: 'Score-Based Generative Modeling through Stochastic Differential Equations',
      authors: 'Song, Sohl-Dickstein, Kingma, Kumar, Ermon, Poole',
      year: 2020,
      venue: 'ICLR 2021',
      arxivId: '2011.13456',
      url: 'https://arxiv.org/abs/2011.13456',
      abstract: 'Unifies diffusion probabilistic models and score-based generative models under the continuous mathematical framework of stochastic differential equations (SDEs).',
      keyInsights: [
        'Forward SDE diffuses data to noise; reverse SDE generates samples',
        'Predictor-Corrector samplers improve generation fidelity',
        'Continuous formulation allows arbitrary solver steps',
      ],
      tags: ['SDE', 'Score-Based', 'Theory', 'Diffusion'],
      citationsCount: 5200,
      status: 'seminal',
      color: '#ec4899',
      linkedToNodeId: 'paper-ddpm',
      linkedToPaperTitle: 'DDPM',
      relationType: 'theoretical-foundation',
      relationDescription: 'Continuous SDE mathematical formulation unifying score models',
    },
    {
      id: 'paper-controlnet',
      title: 'Adding Conditional Control to Text-to-Image Diffusion Models (ControlNet)',
      authors: 'Zhang, Rao, Agrawala (Stanford)',
      year: 2023,
      venue: 'ICCV 2023',
      arxivId: '2302.05543',
      url: 'https://arxiv.org/abs/2302.05543',
      abstract: 'Adds spatial conditioning controls (depth maps, canny edges, human poses) to pre-trained large diffusion models using zero-convolutions without breaking original capabilities.',
      keyInsights: [
        'Locked model copy preserves billion-parameter visual knowledge',
        'Trainable model copy connected via zero convolutions initialized at zero',
        'Enables pixel-precise spatial guidance for AI generated images',
      ],
      tags: ['ControlNet', 'Conditioning', 'Spatial Guidance'],
      citationsCount: 3900,
      status: 'seminal',
      color: '#06b6d4',
      linkedToNodeId: 'paper-ddpm',
      linkedToPaperTitle: 'DDPM',
      relationType: 'extends',
      relationDescription: 'Adds spatial conditioning (edges, poses, depth) via zero convolutions',
    },
    {
      id: 'paper-dreambooth',
      title: 'DreamBooth: Fine Tuning Text-to-Image Diffusion Models for Subject-Driven Generation',
      authors: 'Ruiz, Li, Jampani, Pritch, Rubinstein, Aberman (Google Research)',
      year: 2022,
      venue: 'CVPR 2023',
      arxivId: '2208.12242',
      url: 'https://arxiv.org/abs/2208.12242',
      abstract: 'Given 3-5 images of a subject, fine-tunes a text-to-image diffusion model bound to a unique identifier token to synthesize the subject in novel poses and contexts.',
      keyInsights: [
        'Class-specific preservation loss prevents language drift',
        'Rare token identifier binding enables seamless contextual insertion',
      ],
      tags: ['Personalization', 'Subject-Driven', 'Fine-Tuning'],
      citationsCount: 2700,
      status: 'read',
      color: '#e11d48',
      linkedToNodeId: 'paper-ddpm',
      linkedToPaperTitle: 'DDPM',
      relationType: 'extends',
      relationDescription: 'Fine-tunes diffusion models on specific subjects using rare tokens',
    },
  ],

  // 7. RAG Papers (dash-3)
  'paper-rag': [
    {
      id: 'paper-dpr',
      title: 'Dense Passage Retrieval for Open-Domain Question Answering (DPR)',
      authors: 'Karpukhin, Oguz, Min, Lewis, Wu, Edunov, Chen, Yih',
      year: 2020,
      venue: 'EMNLP 2020',
      arxivId: '2004.04906',
      url: 'https://arxiv.org/abs/2004.04906',
      abstract: 'Shows retrieval can be practically implemented using dense representations, where embeddings are learned via dual encoders, vastly outperforming Lucene/BM25.',
      keyInsights: [
        'Dual-encoder BERT architecture for question and passage',
        'In-batch negative sampling enables fast training',
        'Standard indexing backbone for vector databases (Chroma, Pinecone)',
      ],
      tags: ['DPR', 'Dense Retrieval', 'Vector Search'],
      citationsCount: 3800,
      status: 'seminal',
      color: '#10b981',
      linkedToNodeId: 'paper-rag',
      linkedToPaperTitle: 'RAG',
      relationType: 'theoretical-foundation',
      relationDescription: 'Dual-encoder dense passage retriever replacing lexical BM25 search',
    },
    {
      id: 'paper-graphrag',
      title: 'From Local to Global Knowledge Retrieval with GraphRAG',
      authors: 'Edge et al. (Microsoft Research)',
      year: 2024,
      venue: 'arXiv 2024',
      arxivId: '2404.16130',
      url: 'https://arxiv.org/abs/2404.16130',
      abstract: 'Extracts knowledge graphs from text corpora and generates community summaries via graph clustering, answering complex multi-hop and holistic dataset questions.',
      keyInsights: [
        'Overcomes standard vector RAG failure on broad thematic queries',
        'Hierarchical Leiden community clustering over extracted entities',
        'Significant improvement on comprehensive sensemaking tasks',
      ],
      tags: ['GraphRAG', 'Knowledge Graphs', 'Multi-Hop'],
      citationsCount: 850,
      status: 'seminal',
      color: '#059669',
      linkedToNodeId: 'paper-rag',
      linkedToPaperTitle: 'RAG',
      relationType: 'extends',
      relationDescription: 'Extracts knowledge graphs & community hierarchies for global queries',
    },
    {
      id: 'paper-dspy',
      title: 'DSPy: Compiling Declarative Language Model Calls into State-of-the-Art Pipelines',
      authors: 'Khattab, Singh, Santhanam, Awadallah, Potts, Zaharia (Stanford)',
      year: 2023,
      venue: 'ICLR 2024',
      arxivId: '2310.03714',
      url: 'https://arxiv.org/abs/2310.03714',
      abstract: 'Replaces brittle prompt engineering with declarative modules and self-optimizing compilers that automatically synthesize prompts and fine-tune weights for RAG pipelines.',
      keyInsights: [
        'Separates program logic (Signatures/Modules) from prompting strategies',
        'Automatic teleprompters (Bayesian, Bootstrap) optimize few-shot exemplars',
        'Systematic algorithmic compilation outperforms handcrafted prompts',
      ],
      tags: ['DSPy', 'Compilation', 'Pipelines', 'Optimization'],
      citationsCount: 1600,
      status: 'seminal',
      color: '#0284c7',
      linkedToNodeId: 'paper-rag',
      linkedToPaperTitle: 'RAG',
      relationType: 'extends',
      relationDescription: 'Declarative framework compiling and optimizing multi-stage RAG prompts',
    },
  ],
};

/**
 * Get all linked papers for a given node ID, or search by paper title if ID not matched
 */
export function getLinkedPapersForNode(
  nodeId: string,
  nodeTitle?: string
): LinkedPaperItem[] {
  if (LINKED_PAPERS_DATABASE[nodeId]) {
    return LINKED_PAPERS_DATABASE[nodeId];
  }

  // Fallback: match by title keywords
  if (nodeTitle) {
    const titleLower = nodeTitle.toLowerCase();
    for (const key of Object.keys(LINKED_PAPERS_DATABASE)) {
      const list = LINKED_PAPERS_DATABASE[key];
      if (list.length > 0 && titleLower.includes(list[0].linkedToPaperTitle.toLowerCase().slice(0, 10))) {
        return list;
      }
    }
  }

  // Fallback general AI seminal papers
  return [
    {
      id: `paper-fallback-lora-${nodeId}`,
      title: 'LoRA: Low-Rank Adaptation of Large Language Models',
      authors: 'Hu et al. (Microsoft)',
      year: 2021,
      venue: 'ICLR 2022',
      arxivId: '2106.09685',
      abstract: 'Freezes model weights and injects trainable rank decomposition matrices into attention layers.',
      keyInsights: ['Parameter-efficient fine-tuning', 'Reduces GPU VRAM requirements by 3x'],
      tags: ['PEFT', 'Efficiency'],
      citationsCount: 16500,
      status: 'seminal',
      color: '#0ea5e9',
      linkedToNodeId: nodeId,
      linkedToPaperTitle: nodeTitle || 'Selected Paper',
      relationType: 'extends',
      relationDescription: 'Parameter-efficient fine-tuning adaptation',
    },
    {
      id: `paper-fallback-dpo-${nodeId}`,
      title: 'Direct Preference Optimization: Your Language Model is Secretly a Reward Model',
      authors: 'Rafailov et al. (Stanford)',
      year: 2023,
      venue: 'NeurIPS 2023',
      arxivId: '2305.18290',
      abstract: 'Solves preference optimization with a simple cross-entropy binary loss without separate reward models.',
      keyInsights: ['Replaces PPO RL with exact closed-form objective', 'Stable alignment training'],
      tags: ['Alignment', 'DPO'],
      citationsCount: 4100,
      status: 'seminal',
      color: '#8b5cf6',
      linkedToNodeId: nodeId,
      linkedToPaperTitle: nodeTitle || 'Selected Paper',
      relationType: 'improves',
      relationDescription: 'Closed-form alignment loss replacing reinforcement learning',
    },
  ];
}

/**
 * Returns all linked papers across all paper nodes currently in a dashboard
 */
export function getAllLinkedPapersForDashboard(
  dashboardNodes: ResearchPaperNode[]
): LinkedPaperItem[] {
  const all: LinkedPaperItem[] = [];
  const seenIds = new Set<string>();

  for (const node of dashboardNodes) {
    const list = getLinkedPapersForNode(node.id, node.title);
    for (const item of list) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        all.push(item);
      }
    }
  }

  return all;
}

/**
 * Check if a linked paper item is already present on the dashboard as a node
 */
export function isPaperOnDashboard(
  paper: LinkedPaperItem | { id: string; title: string },
  dashboardNodes: ResearchPaperNode[]
): boolean {
  return dashboardNodes.some((node) => {
    if (node.id === paper.id) return true;
    // Match by normalized title or arxivId if present
    const t1 = node.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const t2 = paper.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    return t1 === t2 || (t1.length > 8 && t2.length > 8 && (t1.includes(t2) || t2.includes(t1)));
  });
}
