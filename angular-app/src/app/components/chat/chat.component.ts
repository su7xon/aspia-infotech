import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';

export interface RetrievedChunk {
  id: string;
  source_file: string;
  heading: string;
  text: string;
  similarity_score: number;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  imagePreview?: string | null;
  confidenceScore?: number;
  passedThreshold?: boolean;
  chunksRetrieved?: RetrievedChunk[];
  modelUsed?: string;
  isLoading?: boolean;
}

@Component({
  selector: 'app-sop-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss']
})
export class ChatComponent implements OnInit {
  @ViewChild('chatContainer') private chatContainer!: ElementRef;
  @ViewChild('fileInput') private fileInput!: ElementRef;

  private readonly laravelApiUrl = 'http://localhost:8000/api/v1/chatbot/ask';
  
  messages: ChatMessage[] = [];
  userQuestion: string = '';
  selectedImageBase64: string | null = null;
  selectedImagePreview: string | null = null;
  selectedFileName: string | null = null;
  isSending: boolean = false;
  confidenceThreshold: number = 0.60;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.messages.push({
      id: 'welcome_1',
      sender: 'assistant',
      text: 'Hello! I am your internal SOP Assistant. Ask me any question regarding our company standard operating procedures, guidelines, or equipment operation.',
      timestamp: new Date(),
      confidenceScore: 1.0,
      passedThreshold: true,
      modelUsed: 'qwen2.5vl'
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file (PNG, JPEG, WebP).');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size exceeds 5MB limit.');
        return;
      }

      this.selectedFileName = file.name;
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        this.selectedImagePreview = result;
        this.selectedImageBase64 = result;
      };
      reader.readAsDataURL(file);
    }
  }

  removeSelectedImage(): void {
    this.selectedImageBase64 = null;
    this.selectedImagePreview = null;
    this.selectedFileName = null;
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  sendMessage(): void {
    const question = this.userQuestion.trim();
    if (!question && !this.selectedImageBase64) return;
    if (this.isSending) return;

    const userMsgId = 'usr_' + Date.now();
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      text: question || '(Uploaded Image for SOP Analysis)',
      timestamp: new Date(),
      imagePreview: this.selectedImagePreview
    };

    this.messages.push(userMsg);

    const botMsgId = 'bot_' + Date.now();
    const botPlaceholder: ChatMessage = {
      id: botMsgId,
      sender: 'assistant',
      text: 'Searching SOP library and analyzing query...',
      timestamp: new Date(),
      isLoading: true
    };
    this.messages.push(botPlaceholder);

    const payload = {
      question: question || 'Please analyze this SOP document image or error screenshot.',
      image: this.selectedImageBase64,
      confidence_threshold: this.confidenceThreshold
    };

    const tempImagePreview = this.selectedImagePreview;
    this.userQuestion = '';
    this.removeSelectedImage();
    this.isSending = true;
    this.scrollToBottom();

    this.http.post<any>(this.laravelApiUrl, payload).subscribe({
      next: (res) => {
        const data = res?.data || res;
        const index = this.messages.findIndex(m => m.id === botMsgId);
        if (index !== -1) {
          this.messages[index] = {
            id: botMsgId,
            sender: 'assistant',
            text: data.answer || "This isn't covered in our SOPs — please contact the concerned department.",
            timestamp: new Date(),
            confidenceScore: data.confidence_score,
            passedThreshold: data.passed_threshold,
            chunksRetrieved: data.chunks_retrieved || [],
            modelUsed: data.model_used || 'qwen2.5vl',
            isLoading: false
          };
        }
        this.isSending = false;
        this.scrollToBottom();
      },
      error: (err) => {
        console.error('API Error:', err);
        const index = this.messages.findIndex(m => m.id === botMsgId);
        if (index !== -1) {
          this.messages[index] = {
            id: botMsgId,
            sender: 'assistant',
            text: "This isn't covered in our SOPs — please contact the concerned department.",
            timestamp: new Date(),
            confidenceScore: 0.0,
            passedThreshold: false,
            chunksRetrieved: [],
            modelUsed: 'fallback',
            isLoading: false
          };
        }
        this.isSending = false;
        this.scrollToBottom();
      }
    });
  }

  scrollToBottom(): void {
    setTimeout(() => {
      try {
        if (this.chatContainer) {
          this.chatContainer.nativeElement.scrollTop = this.chatContainer.nativeElement.scrollHeight;
        }
      } catch (e) {}
    }, 100);
  }
}
